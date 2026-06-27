/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS STE PORTAL — SERVICE WORKER (sw-etuklas.js)
   ─────────────────────────────────────────────────────────────
   PLACE THIS FILE at the ROOT of your website folder.
   e.g. if your site is at https://etuklas.example.com/
        this file must be at https://etuklas.example.com/sw-etuklas.js

   This is what makes push notifications arrive on the phone or
   desktop EVEN WHEN the browser / tab is closed — just like
   Facebook Messenger or Gmail does it.
═══════════════════════════════════════════════════════════════ */

var CACHE_NAME = 'etuklas-push-v1';

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] E-Tuklas Push SW installed');
  self.skipWaiting(); // activate immediately
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] E-Tuklas Push SW activated');
  event.waitUntil(self.clients.claim()); // take control of all tabs
});

// ── PUSH EVENT ───────────────────────────────────────────────
// Fires when your server sends a push message to the browser.
// The browser wakes up this SW (even if the tab is closed) and
// we show the notification here.
self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'E-Tuklas STE Portal', body: event.data ? event.data.text() : 'You have a new notification.' };
  }

  var title = data.title || 'E-Tuklas STE Portal';
  var options = {
    body: data.body || 'You have a new notification.',
    icon: data.icon || '/etuklas-icon-192.png',
    badge: '/etuklas-badge-72.png',
    tag: data.tag || 'etuklas-notif',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: data.requireInteraction || false,
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
// When the user taps the notification on their phone/desktop,
// this opens the portal and focuses the right page.
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var action = event.action;
  if (action === 'dismiss') return; // user dismissed — do nothing

  var targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // If portal tab is already open → focus it and navigate
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ── PUSH SUBSCRIPTION CHANGE ──────────────────────────────────
// Fires if the browser rotates the push subscription (rare).
// Re-send the new subscription to your backend.
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options)
      .then(function(newSub) {
        // TODO: POST newSub to your backend endpoint
        // fetch('/api/push-subscribe', { method:'POST', body: JSON.stringify(newSub), headers:{'Content-Type':'application/json'} });
        console.log('[SW] Push subscription renewed');
      })
  );
});
