// SMART START service worker (v5): caches the app shell only. Tracker data lives in
// Firestore and is cached by the Firestore SDK after sign-in; data.json is never
// served from the hosted site and never cached here. Firebase and font requests
// pass straight through.
const VERSION = 'smartstart-v85';  // app 2.27.3
const SHELL = ['./', './index.html', './manifest.webmanifest', './firebase-config.js',
  './stuart.js', './privacy.html', './terms.html',
  './icons/smartstart-icon-light.svg?v=3', './icons/smartstart-icon-dark.svg?v=3', './icons/stuart.svg', './icons/smartstart-icon-light-180.png?v=3'];
self.addEventListener('install', e => {
  // cache: 'reload' fetches from the server, never from the browser's HTTP cache, so a new deploy's icons arrive at once
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET' || url.pathname.endsWith('/data.json')) return;
  // Media goes straight to the network: Safari plays video only from byte-range (206) responses, which a service worker must not rewrite.
  if (url.pathname.startsWith('/preview/') || e.request.headers.has('range')) return;
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/guide/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; })));
    return;
  }
  // Shell: network first so a new deploy shows on the next open; cache keeps it working offline.
  e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
