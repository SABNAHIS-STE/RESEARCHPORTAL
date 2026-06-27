/* ═══════════════════════════════════════════════════════════════
   E-TUKLAS STE PORTAL — FIREBASE CLOUD MESSAGING SERVICE WORKER
   firebase-messaging-sw.js
   ─────────────────────────────────────────────────────────────
   ⚠️  PLACE THIS FILE at the ROOT of your website on GitHub:
       yourusername.github.io/firebase-messaging-sw.js

   This is what delivers push notifications to students' phones
   even when their browser is completely closed — just like
   Facebook Messenger and Gmail do it.

   HOW IT WORKS:
   1. Student visits your portal and clicks "Allow Notifications"
   2. Firebase gives their device a unique token (like a phone number)
   3. That token is saved to Firestore under their user profile
   4. When you post an announcement / grade a study, Firebase
      sends a push to ALL saved tokens instantly
   5. This service worker wakes up on their phone and shows it
═══════════════════════════════════════════════════════════════ */

// ── Import Firebase scripts (must match version in your portal) ─
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ── Your Firebase config (same as in your portal HTML) ──────────
firebase.initializeApp({
  apiKey:            "AIzaSyD_2lO2W9OvEh0c8uMO_AEUZcQz8YTqZU8",
  authDomain:        "sabnahis-portal.firebaseapp.com",
  projectId:         "sabnahis-portal",
  storageBucket:     "sabnahis-portal.firebasestorage.app",
  messagingSenderId: "155537469341",
  appId:             "1:155537469341:web:85650f06744d422dc58974"
});

const messaging = firebase.messaging();

// ── BACKGROUND PUSH HANDLER ──────────────────────────────────────
// This fires when the student's tab is CLOSED or phone is locked.
// Firebase automatically shows the notification — you can customize
// how it looks here.
messaging.onBackgroundMessage(function(payload) {
  console.log('[E-Tuklas FCM] Background message received:', payload);

  const data        = payload.data || {};
  const notification = payload.notification || {};

  const title = notification.title || data.title || '🎓 E-Tuklas STE Portal';
  const body  = notification.body  || data.body  || 'You have a new notification.';

  // Emoji icons by notification type
  const typeIcons = {
    announcement : '📢',
    grade        : '⭐',
    review       : '📝',
    recognition  : '🏅',
    coauthor     : '🤝',
    revision     : '🔄',
    default      : '🎓'
  };
  const icon = typeIcons[data.type] || typeIcons.default;

  const options = {
    body    : body,
    icon    : '/etuklas-icon-192.png',   // add this image to your GitHub repo
    badge   : '/etuklas-badge-72.png',   // small monochrome icon (Android)
    tag     : data.tag || 'etuklas-' + (data.type || 'notif'),
    data    : { url: data.url || '/' },
    vibrate : [200, 100, 200],
    requireInteraction: data.requireInteraction === 'true',
    actions : [
      { action: 'view',    title: '👁 View'     },
      { action: 'dismiss', title: '✕ Dismiss'  }
    ]
  };

  return self.registration.showNotification(title, options);
});

// ── NOTIFICATION CLICK HANDLER ───────────────────────────────────
// When the student taps the notification on their phone,
// this opens your portal and focuses the correct page.
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // If portal already open in a tab → focus it
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
