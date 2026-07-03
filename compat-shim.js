/*!
 * compat-shim.js — Firebase compat SDK → Supabase adapter
 * ---------------------------------------------------------------------------
 * Drop-in replacement for firebase-app-compat.js / firebase-auth-compat.js /
 * firebase-firestore-compat.js / firebase-messaging-compat.js.
 *
 * It re-creates the small slice of the `firebase.*` API this app actually
 * uses (auth, firestore CRUD/queries/batch/transaction/FieldValue,
 * messaging.getToken/onMessage) on top of `@supabase/supabase-js`, so the
 * rest of the 18k-line app file does not need to change.
 *
 * Load order in the HTML:
 *   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   2. <script> window.__SUPABASE_URL__ = "..."; window.__SUPABASE_ANON_KEY__ = "..."; </script>
 *   3. <script src="./compat-shim.js"></script>
 *   4. (then the app's existing `const auth = firebase.auth(); const db = firebase.firestore();` lines)
 *
 * KNOWN LIMITATIONS (see MIGRATION-README.md for detail):
 *   - onSnapshot() is "refetch on any change" rather than true incremental
 *     deltas from the server — fine for the 2 listeners this app uses
 *     (drafts list, announcements banner), not meant for huge collections.
 *   - runTransaction() executes reads immediately (no lock) and writes are
 *     committed atomically at the end via one RPC call, but there is no
 *     automatic optimistic-retry the way real Firestore transactions have.
 *     For the one true dedupe-sensitive transaction in this app
 *     (grantBadgeTokens), add the unique index suggested in schema.sql.
 *   - collectionGroup() assumes each subcollection *name* only ever lives
 *     under one parent type (true for this app: "views" only exists under
 *     studies, "notifications" only under users, etc).
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  if (!global.supabase || !global.supabase.createClient) {
    throw new Error('[compat-shim] Load the Supabase JS SDK before compat-shim.js');
  }
  if (!global.__SUPABASE_URL__ || !global.__SUPABASE_ANON_KEY__) {
    throw new Error('[compat-shim] Set window.__SUPABASE_URL__ / __SUPABASE_ANON_KEY__ before compat-shim.js');
  }

  var sb = global.supabase.createClient(global.__SUPABASE_URL__, global.__SUPABASE_ANON_KEY__, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  global.__sb = sb; // exposed for debugging / the migration/edge-function docs

  // Set this (in the same script tag as __SUPABASE_URL__) once you deploy
  // supabase/functions/firebase-password-bridge, e.g.:
  //   window.__FIREBASE_PASSWORD_BRIDGE_URL__ =
  //     "https://YOUR-PROJECT-REF.supabase.co/functions/v1/firebase-password-bridge";
  // Leave unset to skip this fallback entirely (plain reset-email flow only).
  global.__FIREBASE_PASSWORD_BRIDGE_URL__ = global.__FIREBASE_PASSWORD_BRIDGE_URL__ || null;

  // A password-reset email link opens in whatever browser the person is
  // using to check email — not necessarily the one that requested the
  // reset — so this app uses the "implicit" auth flow (tokens embedded
  // directly in the redirect URL) rather than PKCE, which requires the
  // requesting browser and the link-opening browser to match.
  //
  // When someone lands here via a recovery link, Supabase fires a
  // PASSWORD_RECOVERY auth event. There's no dedicated "set new password"
  // screen carried over from the old Firebase app, so this provides a
  // minimal one so the flow actually completes end-to-end. Replace this
  // with a proper in-app form whenever convenient.
  sb.auth.onAuthStateChange(function (event) {
    if (event !== 'PASSWORD_RECOVERY') return;
    var pw = global.prompt('Enter a new password (at least 6 characters):');
    if (!pw || pw.length < 6) { global.alert('Password not changed — must be at least 6 characters.'); return; }
    sb.auth.updateUser({ password: pw }).then(function (res) {
      if (res.error) { global.alert('Could not update password: ' + res.error.message); return; }
      global.alert('Password updated — you can log in with it now.');
    });
  });

  // ---- Firestore collection name -> Postgres table name -------------------
  var TABLE_MAP = {
    users: 'users', studies: 'studies', config: 'config', announcements: 'announcements',
    auditLog: 'audit_log', recognized_studies: 'recognized_studies', shopItems: 'shop_items',
    shopRedemptions: 'shop_redemptions', pendingReviews: 'pending_reviews', feedback: 'feedback',
    stat_analyses: 'stat_analyses',
    notifications: 'user_notifications', favorites: 'user_favorites', checklist: 'user_checklist',
    lastRead: 'user_last_read', readStudies: 'user_read_studies', streak: 'user_streak',
    freezes: 'user_freezes', wallet: 'user_wallet', tokenLog: 'user_token_log',
    redemptions: 'user_redemptions',
    favoriteBy: 'study_favorite_by', teacherFeedback: 'study_teacher_feedback',
    revisions: 'study_revisions', reviews: 'study_reviews', views: 'study_views',
    downloads: 'study_downloads', citations: 'study_citations'
  };
  function tableFor(collName) { return TABLE_MAP[collName] || collName; }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function mapError(error) {
    var e = new Error((error && error.message) || String(error));
    var msg = ((error && error.message) || '').toLowerCase();
    if (msg.indexOf('invalid login credentials') !== -1) e.code = 'auth/invalid-credential';
    else if (msg.indexOf('already registered') !== -1) e.code = 'auth/email-already-in-use';
    else if (msg.indexOf('email not confirmed') !== -1) e.code = 'auth/user-disabled';
    else if (msg.indexOf('network') !== -1) e.code = 'auth/network-request-failed';
    else if (msg.indexOf('rate limit') !== -1 || msg.indexOf('too many') !== -1) e.code = 'auth/too-many-requests';
    else if (msg.indexOf('invalid email') !== -1) e.code = 'auth/invalid-email';
    else e.code = (error && error.code) || 'unknown';
    return e;
  }

  // ---- FieldValue markers ---------------------------------------------------
  function increment(n) { return { __op: 'increment', value: n }; }
  function arrayUnion() { return { __op: 'arrayUnion', values: Array.prototype.slice.call(arguments) }; }
  function arrayRemove() { return { __op: 'arrayRemove', values: Array.prototype.slice.call(arguments) }; }
  function deleteField() { return { __op: 'delete' }; }
  function serverTimestamp() { return new Date().toISOString(); }

  function splitPayload(data) {
    var set = {}, deletes = [], increments = {}, arrayUnions = {}, arrayRemoves = {};
    Object.keys(data || {}).forEach(function (k) {
      var v = data[k];
      if (v && typeof v === 'object' && v.__op === 'increment') increments[k] = v.value;
      else if (v && typeof v === 'object' && v.__op === 'arrayUnion') arrayUnions[k] = v.values;
      else if (v && typeof v === 'object' && v.__op === 'arrayRemove') arrayRemoves[k] = v.values;
      else if (v && typeof v === 'object' && v.__op === 'delete') deletes.push(k);
      else set[k] = v;
    });
    return { set: set, deletes: deletes, increments: increments, arrayUnions: arrayUnions, arrayRemoves: arrayRemoves };
  }

  async function rpcMutate(table, id, parentId, data, merge) {
    var p = splitPayload(data);
    var { error } = await sb.rpc('firestore_mutate', {
      p_table: table, p_id: id, p_parent_id: parentId || null,
      p_set: p.set, p_merge: !!merge, p_delete_keys: p.deletes,
      p_increments: p.increments, p_array_unions: p.arrayUnions, p_array_removes: p.arrayRemoves
    });
    if (error) throw mapError(error);
  }

  function opFromPayload(kind, table, id, parentId, data, merge) {
    var p = splitPayload(data);
    return {
      op: kind === 'delete' ? 'delete' : 'mutate',
      table: table, id: id, parent_id: parentId || null,
      set: p.set, merge: kind === 'update' ? true : !!merge,
      delete_keys: p.deletes, increments: p.increments,
      array_unions: p.arrayUnions, array_removes: p.arrayRemoves
    };
  }

  // ---- DocumentSnapshot / QueryDocumentSnapshot -----------------------------
  function makeDocSnap(collName, row, fallbackId) {
    var id = row ? row.id : fallbackId;
    return {
      id: id,
      exists: !!row,
      data: function () { return row ? Object.assign({}, row.data) : undefined; },
      ref: makeDocRef(collName, id, row ? row.parent_id : undefined)
    };
  }

  // ---- DocumentReference ------------------------------------------------
  function makeDocRef(collName, id, parentId) {
    var table = tableFor(collName);
    id = id || newId();
    var ref = {
      id: id,
      _table: table,
      _coll: collName,
      _parentId: parentId,
      get: async function () {
        var q = sb.from(table).select('*').eq('id', id);
        var { data, error } = await q.maybeSingle();
        if (error) throw mapError(error);
        return makeDocSnap(collName, data, id);
      },
      set: async function (data, opts) {
        await rpcMutate(table, id, parentId, data, opts && opts.merge);
      },
      update: async function (data) {
        await rpcMutate(table, id, parentId, data, true);
      },
      delete: async function () {
        var { error } = await sb.rpc('firestore_delete', { p_table: table, p_id: id });
        if (error) throw mapError(error);
      },
      collection: function (subName) { return makeCollectionRef(subName, id); },
      onSnapshot: function (onNext, onError) { return watchDoc(collName, table, id, onNext, onError); }
    };
    return ref;
  }

  // ---- CollectionReference / Query ------------------------------------------
  function makeCollectionRef(collName, parentId) {
    return makeQuery({ collName: collName, table: tableFor(collName), parentId: parentId || null, filters: [], orders: [], limitN: null });
  }

  function applyFilter(q, f) {
    var col = 'data->>' + f.field;
    switch (f.op) {
      case '==': return q.eq(col, f.value);
      case '!=': return q.neq(col, f.value);
      case '<': return q.lt(col, f.value);
      case '<=': return q.lte(col, f.value);
      case '>': return q.gt(col, f.value);
      case '>=': return q.gte(col, f.value);
      case 'in': return q.in(col, f.value);
      case 'array-contains': return q.contains('data->' + f.field, JSON.stringify([f.value]));
      default: throw new Error('[compat-shim] unsupported where() operator: ' + f.op);
    }
  }

  async function runQuery(state) {
    var q = sb.from(state.table).select('*');
    if (state.parentId) q = q.eq('parent_id', state.parentId);
    state.filters.forEach(function (f) { q = applyFilter(q, f); });
    state.orders.forEach(function (o) { q = q.order('data->>' + o.field, { ascending: o.dir !== 'desc' }); });
    if (state.limitN) q = q.limit(state.limitN);
    var { data, error } = await q;
    if (error) throw mapError(error);
    var docs = (data || []).map(function (row) { return makeDocSnap(state.collName, row); });
    return {
      docs: docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: function (fn) { docs.forEach(fn); },
      docChanges: function () { return docs.map(function (d) { return { type: 'added', doc: d }; }); }
    };
  }

  function makeQuery(state) {
    return {
      doc: function (id) { return makeDocRef(state.collName, id, state.parentId); },
      where: function (field, op, value) {
        return makeQuery(Object.assign({}, state, { filters: state.filters.concat([{ field: field, op: op, value: value }]) }));
      },
      orderBy: function (field, dir) {
        return makeQuery(Object.assign({}, state, { orders: state.orders.concat([{ field: field, dir: dir || 'asc' }]) }));
      },
      limit: function (n) { return makeQuery(Object.assign({}, state, { limitN: n })); },
      add: async function (data) {
        var ref = makeDocRef(state.collName, undefined, state.parentId);
        await ref.set(data);
        return ref;
      },
      get: async function () { return runQuery(state); },
      onSnapshot: function (onNext, onError) { return watchQuery(state, onNext, onError); }
    };
  }

  // ---- Realtime (refetch-on-change) ------------------------------------------
  function watchQuery(state, onNext, onError) {
    var prev = new Map();
    var active = true;
    var channel;
    async function refresh() {
      try {
        var snap = await runQuery(state);
        var changes = [];
        var next = new Map();
        snap.docs.forEach(function (d) {
          next.set(d.id, d);
          changes.push({ type: prev.has(d.id) ? 'modified' : 'added', doc: d });
        });
        prev.forEach(function (d, id) { if (!next.has(id)) changes.push({ type: 'removed', doc: d }); });
        prev = next;
        snap.docChanges = function () { return changes; };
        if (active) onNext(snap);
      } catch (e) { if (onError) onError(e); }
    }
    refresh();
    channel = sb.channel('q_' + state.table + '_' + newId()).on(
      'postgres_changes',
      Object.assign({ event: '*', schema: 'public', table: state.table }, state.parentId ? { filter: 'parent_id=eq.' + state.parentId } : {}),
      function () { refresh(); }
    ).subscribe();
    return function unsubscribe() { active = false; sb.removeChannel(channel); };
  }

  function watchDoc(collName, table, id, onNext, onError) {
    var active = true;
    async function refresh() {
      try {
        var { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (active) onNext(makeDocSnap(collName, data, id));
      } catch (e) { if (onError) onError(e); }
    }
    refresh();
    var channel = sb.channel('d_' + table + '_' + id).on(
      'postgres_changes', { event: '*', schema: 'public', table: table, filter: 'id=eq.' + id },
      function () { refresh(); }
    ).subscribe();
    return function unsubscribe() { active = false; sb.removeChannel(channel); };
  }

  // ---- firestore() ------------------------------------------------------
  var dbShim = {
    collection: function (name) { return makeCollectionRef(name, null); },
    collectionGroup: function (name) { return makeCollectionRef(name, null); },
    batch: function () {
      var ops = [];
      return {
        set: function (ref, data, opts) { ops.push(opFromPayload('set', ref._table, ref.id, ref._parentId, data, opts && opts.merge)); },
        update: function (ref, data) { ops.push(opFromPayload('update', ref._table, ref.id, ref._parentId, data, true)); },
        delete: function (ref) { ops.push({ op: 'delete', table: ref._table, id: ref.id }); },
        commit: async function () {
          if (!ops.length) return;
          var { error } = await sb.rpc('firestore_batch', { p_ops: ops });
          if (error) throw mapError(error);
        }
      };
    },
    runTransaction: async function (updateFn) {
      var ops = [];
      var tx = {
        get: function (ref) { return ref.get(); },
        set: function (ref, data, opts) { ops.push(opFromPayload('set', ref._table, ref.id, ref._parentId, data, opts && opts.merge)); return tx; },
        update: function (ref, data) { ops.push(opFromPayload('update', ref._table, ref.id, ref._parentId, data, true)); return tx; },
        delete: function (ref) { ops.push({ op: 'delete', table: ref._table, id: ref.id }); return tx; }
      };
      var result = await updateFn(tx);
      if (ops.length) {
        var { error } = await sb.rpc('firestore_batch', { p_ops: ops });
        if (error) throw mapError(error);
      }
      return result;
    }
  };

  // ---- auth() -------------------------------------------------------------
  function toFbUser(supaUser) {
    if (!supaUser) return null;
    return {
      uid: supaUser.id,
      email: supaUser.email,
      isAnonymous: supaUser.is_anonymous === true,
      updatePassword: async function (newPassword) {
        var { error } = await sb.auth.updateUser({ password: newPassword });
        if (error) throw mapError(error);
      },
      getIdToken: async function () {
        var { data } = await sb.auth.getSession();
        return data && data.session ? data.session.access_token : null;
      }
    };
  }

  var currentFbUser = null;
  var authShim = {
    get currentUser() { return currentFbUser; },
    setPersistence: async function () { return true; }, // supabase-js persists to localStorage by default
    createUserWithEmailAndPassword: async function (email, password) {
      var { data, error } = await sb.auth.signUp({ email: email, password: password });
      if (error) throw mapError(error);
      var user = data.user;
      if (!data.session) {
        var signIn = await sb.auth.signInWithPassword({ email: email, password: password });
        if (signIn.error) throw mapError(signIn.error);
        user = signIn.data.user;
      }
      currentFbUser = toFbUser(user);
      return { user: currentFbUser };
    },
    signInWithEmailAndPassword: async function (email, password) {
      var first = await sb.auth.signInWithPassword({ email: email, password: password });
      if (!first.error) {
        currentFbUser = toFbUser(first.data.user);
        return { user: currentFbUser };
      }

      // Wrong/temp password on an account migrated from Firebase? Ask the
      // bridge function to check the same credentials against Firebase
      // directly; if correct, it syncs the password onto this Supabase
      // account and we transparently retry. See MIGRATION-README.md.
      if (global.__FIREBASE_PASSWORD_BRIDGE_URL__) {
        try {
          var bridgeRes = await fetch(global.__FIREBASE_PASSWORD_BRIDGE_URL__, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + global.__SUPABASE_ANON_KEY__,
              'apikey': global.__SUPABASE_ANON_KEY__
            },
            body: JSON.stringify({ email: email, password: password })
          });
          var bridgeJson = await bridgeRes.json();
          if (bridgeJson && bridgeJson.migrated) {
            var retry = await sb.auth.signInWithPassword({ email: email, password: password });
            if (!retry.error) {
              currentFbUser = toFbUser(retry.data.user);
              return { user: currentFbUser };
            }
          }
        } catch (bridgeErr) { /* fall through to the original error below */ }
      }

      throw mapError(first.error);
    },
    signInAnonymously: async function () {
      var { data, error } = await sb.auth.signInAnonymously();
      if (error) throw mapError(error);
      currentFbUser = toFbUser(data.user);
      return { user: currentFbUser };
    },
    signOut: async function () {
      var { error } = await sb.auth.signOut();
      if (error) throw mapError(error);
      currentFbUser = null;
    },
    onAuthStateChanged: function (onNext, onError) {
      var { data: sub } = sb.auth.onAuthStateChange(function (event, session) {
        currentFbUser = toFbUser(session ? session.user : null);
        try { onNext(currentFbUser); } catch (e) { if (onError) onError(e); }
      });
      return function unsubscribe() { sub.subscription.unsubscribe(); };
    }
  };

  // ---- messaging() ----------------------------------------------------------
  // FCM is retired in favor of native Web Push (VAPID) + a Supabase Edge
  // Function — see MIGRATION-README.md. getToken() always resolves null so
  // the app's own existing `if (token) ... else tryNativePush()` fallback
  // (already in the app for iOS) runs unconditionally for every platform.
  var messagingShim = {
    useServiceWorker: function () {},
    onMessage: function () {},
    getToken: async function () { return null; }
  };

  // ---- global firebase namespace ---------------------------------------------
  global.firebase = {
    apps: [],
    initializeApp: function () { global.firebase.apps.push({}); return {}; },
    auth: function () { return authShim; },
    firestore: function () { return dbShim; },
    messaging: function () { return messagingShim; }
  };
  global.firebase.auth.Auth = { Persistence: { LOCAL: 'LOCAL', SESSION: 'SESSION', NONE: 'NONE' } };
  global.firebase.firestore.FieldValue = {
    increment: increment, delete: deleteField, arrayUnion: arrayUnion,
    arrayRemove: arrayRemove, serverTimestamp: serverTimestamp
  };
})(window);
