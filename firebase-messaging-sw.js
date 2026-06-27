/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS — FIREBASE MESSAGING SERVICE WORKER
   Rewritten for iOS Safari PWA compatibility
═══════════════════════════════════════════════════════════════ */

/* iOS Safari PWA does not support importScripts with Firebase SDK.
   Instead we use the native Push API directly here, and let the
   Firebase Admin SDK on Render.com handle the actual sending.    */

self.addEventListener('install', function(e) {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  console.log('[SW] Activated');
  e.waitUntil(self.clients.claim());
});

/* ── PUSH EVENT ─────────────────────────────────────────────────
   Fires when Render server sends a push — works on ALL browsers
   including iOS Safari PWA (iOS 16.4+)                          */
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

  var title = data.title || '🎓 E-Tuklas STE Portal';
  var body  = data.body  || 'You have a new notification.';

  var options = {
    body:    body,
    icon:    '/LOGO.png',
    badge:   '/LOGO.png',
    tag:     data.tag || 'etuklas-notif',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
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
        for (var i = 0; i < list.length; i++) {
          if ('focus' in list[i]) {
            list[i].focus();
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

/* ── FIREBASE BACKGROUND MESSAGES (Android Chrome) ─────────────
   Only loaded if importScripts works (non-iOS browsers)         */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

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

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(function(payload) {
    // Already handled by push event above — skip to avoid double notification
    console.log('[SW] FCM background message (handled by push event)');
  });
} catch(e) {
  // iOS Safari — importScripts not supported, push event handles it above
  console.log('[SW] Running in iOS mode — push event handles notifications');
}
