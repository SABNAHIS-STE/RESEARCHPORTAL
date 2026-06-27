/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS — FIREBASE MESSAGING SERVICE WORKER
   Fixed for iOS Safari PWA + Android Chrome compatibility
═══════════════════════════════════════════════════════════════ */

self.addEventListener('install', function(e) {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  console.log('[SW] Activated');
  e.waitUntil(self.clients.claim());
});

/* ── PUSH EVENT ─────────────────────────────────────────────────
   Handles ALL push notifications including iOS Safari PWA.
   This fires for both native web push AND FCM on all platforms.  */
self.addEventListener('push', function(e) {
  console.log('[SW] Push received');

  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch(err) {
    data = {
      title: 'E-Tuklas STE Portal',
      body:  e.data ? e.data.text() : 'You have a new notification.'
    };
  }

  // Support both flat payload and nested notification key (FCM format)
  var notif = data.notification || data;
  var title = notif.title || data.title || '🎓 E-Tuklas STE Portal';
  var body  = notif.body  || data.body  || 'You have a new notification.';
  var url   = data.url || (data.webpush && data.webpush.fcmOptions && data.webpush.fcmOptions.link) || '/';
  var tag   = data.tag || 'etuklas-notif';

  var options = {
    body:               body,
    icon:               '/LOGO.png',
    badge:              '/LOGO.png',
    tag:                tag,
    renotify:           true,
    data:               { url: url },
    vibrate:            [200, 100, 200],
    requireInteraction: data.priority === 'urgent',
  };

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ── NOTIFICATION CLICK ─────────────────────────────────────── */
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(list) {
        // If a window is already open, focus it and navigate
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(url);
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

/* ── FIREBASE BACKGROUND MESSAGES (Android Chrome only) ────────
   Loaded AFTER push event listener so native push takes priority.
   onBackgroundMessage returns a no-op to prevent double notification
   since our push event above already called showNotification().    */
(function() {
  // Feature-detect: iOS Safari does not support importScripts reliably
  // We check for a known non-iOS indicator before loading Firebase SDK
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

    // ✅ FIX: Return a resolved promise to suppress Firebase's own
    // showNotification() call — our push event already handled it above.
    messaging.onBackgroundMessage(function(payload) {
      console.log('[SW] FCM background message intercepted — already shown by push event');
      // Return without calling showNotification — prevents double notification
      return Promise.resolve();
    });

    console.log('[SW] Firebase SDK loaded for Android/Chrome ✓');
  } catch(err) {
    console.log('[SW] Firebase SDK load failed (non-fatal):', err.message);
  }
})();
