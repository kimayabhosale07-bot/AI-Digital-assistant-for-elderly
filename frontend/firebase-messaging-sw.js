// Register this before Firebase Messaging imports so the SDK leaves the
// application's click handling in place.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/pages/notifications.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      if (client.url === target && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});

importScripts('/js/firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp(self.CAREWISE_FIREBASE_CONFIG);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.data?.title || 'Carewise notification';
  const body = payload.data?.body || '';
  return self.registration.showNotification(title, {
    body,
    icon: '/assets/aistudio/central_brain.png',
    tag: payload.data?.type === 'carewise-test' ? 'carewise-test' : 'carewise-notification',
    data: { url: payload.data?.url || '/pages/notifications.html' },
  });
});
