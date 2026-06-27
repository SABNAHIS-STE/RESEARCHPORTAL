/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS STE PORTAL — UNIFIED SERVICE WORKER  (sw-etuklas.js)
   ─────────────────────────────────────────────────────────────
   PLACE THIS FILE at the ROOT of your website folder.
   e.g. if your site is at https://etuklas.example.com/
        this file must be at https://etuklas.example.com/sw-etuklas.js

   This is the ONLY service worker the portal should register.
   It merges what used to be two separate files:
     - sw-etuklas.js            (native Web Push, notification actions,
                                  pushsubscriptionchange renewal)
     - firebase-messaging-sw.js (Android/Chrome FCM background messages)

   Behavior:
     - The generic 'push' event handles ALL platforms, including
       iOS Safari PWA native Web Push and Android/Chrome FCM
       (FCM delivers through the same Push API under the hood).
     - On Android/Chrome we ALSO load the Firebase Messaging SDK so
       getToken()/onBackgroundMessage() keep working app-side, but its
       onBackgroundMessage handler is a deliberate no-op — the 'push'
       listener above already calls showNotification(), so we never
       show the same notification twice.
     - On iOS we skip importScripts() entirely. iOS Safari does not
       reliably support it, and native push doesn't need Firebase
       messaging in the SW context anyway.
═══════════════════════════════════════════════════════════════ */

var CACHE_NAME = 'etuklas-push-v3';

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] E-Tuklas Push SW installing...');
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] E-Tuklas Push SW activated');
  event.waitUntil(self.clients.claim());
});

// ── PUSH EVENT (handles iOS native push AND Android/Chrome FCM) ──
self.addEventListener('push', function(event) {
  console.log('[SW] Push received');

  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = {
      title: 'E-Tuklas STE Portal',
      body:  event.data ? event.data.text() : 'You have a new notification.'
    };
  }

  // Support both flat payload and nested notification key (FCM format)
  var notif = data.notification || data;
  var title = notif.title || data.title || '🎓 E-Tuklas STE Portal';
  var body  = notif.body  || data.body  || 'You have a new notification.';

  // Resolve url from multiple possible payload locations
  var url = data.url
    || (data.webpush && data.webpush.fcmOptions && data.webpush.fcmOptions.link)
    || '/';

  var tag = data.tag || 'etuklas-notif';

  var options = {
    body:               body,
    icon:               data.icon || '/LOGO.png',
    badge:              '/LOGO.png',
    tag:                tag,
    renotify:           true,
    data:               { url: url },
    vibrate:            [200, 100, 200, 100, 200],
    requireInteraction: data.priority === 'urgent' || data.requireInteraction === true,
    // Notification actions are ignored on iOS Safari — safe to keep for
    // Android/Chrome/desktop, where they do work.
    actions: data.actions || [
      { action: 'view',    title: '👁 View'    },
      { action: 'dismiss', title: '✕ Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var action = event.action;
  if (action === 'dismiss') return;

  var targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(targetUrl);
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ── PUSH SUBSCRIPTION CHANGE ──────────────────────────────────
// Fires if the browser rotates the push subscription (rare but important
// on iOS — without this, a renewed subscription silently breaks push
// even after it once worked, because the server keeps sending to the
// old, now-invalid subscription).
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription ? event.oldSubscription.options : undefined)
      .then(function(newSub) {
        console.log('[SW] Push subscription renewed — sending to server');
        return fetch('/api/renew-subscription', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subscription: newSub.toJSON() })
        }).catch(function(err) {
          console.warn('[SW] Could not renew subscription on server:', err.message);
        });
      })
      .catch(function(err) {
        console.error('[SW] pushsubscriptionchange failed:', err.message);
      })
  );
});

/* ── FIREBASE BACKGROUND MESSAGES (Android Chrome only) ────────
   Loaded AFTER the push listener so native push always takes
   priority. onBackgroundMessage is a deliberate no-op to prevent a
   double notification, since the push listener above already
   called showNotification() for every platform, including FCM
   deliveries to Chrome.                                          */
(function() {
  // Feature-detect: iOS Safari does not support importScripts() reliably,
  // and doesn't need the Firebase Messaging SDK in the SW context anyway.
  var isIOS = /iP(hone|ad|od)/.test(self.navigator ? self.navigator.userAgent : '');
  if (isIOS) {
    console.log('[SW] iOS detected — skipping Firebase SDK, push event handles everything');
    return;
  }

  try {
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

    if (typeof firebase === 'undefined') return;

    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey:            "AIzaSyD_2lO2W9OvEh0c8uMO_AEUZcQz8YTqZU8",
        authDomain:        "sabnahis-portal.firebaseapp.com",
        projectId:         "sabnahis-portal",
        storageBucket:     "sabnahis-portal.firebasestorage.app",
        messagingSenderId: "155537469341",
        appId:             "1:155537469341:web:85650f06744d422dc58974"
      });
    }

    var messaging = firebase.messaging();

    // Return a resolved promise to suppress Firebase's own
    // showNotification() call — our push event already handled it above.
    messaging.onBackgroundMessage(function(payload) {
      console.log('[SW] FCM background message intercepted — already shown by push event');
      return Promise.resolve();
    });

    console.log('[SW] Firebase SDK loaded for Android/Chrome ✓');
  } catch(err) {
    console.log('[SW] Firebase SDK load failed (non-fatal):', err.message);
  }
})();
