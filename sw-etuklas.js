/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS STE PORTAL — SERVICE WORKER (sw-etuklas.js)
   ─────────────────────────────────────────────────────────────
   PLACE THIS FILE at the ROOT of your website folder.
   e.g. if your site is at https://etuklas.example.com/
        this file must be at https://etuklas.example.com/sw-etuklas.js
═══════════════════════════════════════════════════════════════ */

var CACHE_NAME = 'etuklas-push-v2';

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] E-Tuklas Push SW installed');
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] E-Tuklas Push SW activated');
  event.waitUntil(self.clients.claim());
});

// ── PUSH EVENT ───────────────────────────────────────────────
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = {
      title: 'E-Tuklas STE Portal',
      body:  event.data ? event.data.text() : 'You have a new notification.'
    };
  }

  // ✅ FIX: Support both flat payload and nested FCM notification key
  var notif = data.notification || data;
  var title  = notif.title || data.title || 'E-Tuklas STE Portal';
  var body   = notif.body  || data.body  || 'You have a new notification.';

  // ✅ FIX: Resolve url from multiple possible payload locations
  var url = data.url
    || (data.webpush && data.webpush.fcmOptions && data.webpush.fcmOptions.link)
    || '/';

  var options = {
    body:    body,
    icon:    data.icon || '/LOGO.png',   // ✅ FIX: use LOGO.png to match firebase-messaging-sw.js
    badge:   '/LOGO.png',
    tag:     data.tag || 'etuklas-notif',
    renotify: true,                       // ✅ FIX: always show even if same tag
    data:    { url: url },
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: data.priority === 'urgent' || data.requireInteraction || false,
    // ✅ NOTE: notification actions are ignored on iOS — safe to keep for Android/desktop
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
// Fires if the browser rotates the push subscription (rare but important on iOS).
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then(function(newSub) {
        console.log('[SW] Push subscription renewed — sending to server');
        // ✅ FIX: Actually POST to your /subscribe endpoint (was TODO before)
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
