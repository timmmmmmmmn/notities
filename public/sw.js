// Zorgt dat de website ook zonder internet opent. Eerst het netwerk, anders de bewaarde versie.
// De notities zelf staan in localStorage; /api gaat nooit via deze cache.
const CACHE = 'notities-v2';
const SHELL = ['/', '/app.css', '/app.js', '/theme.js', '/manifest.webmanifest', '/icons/logo.svg', '/icons/icon-192.png', '/icons/favicon-32.png', '/fonts/source-sans-3.woff2', '/fonts/tenor-sans.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request))
  );
});
