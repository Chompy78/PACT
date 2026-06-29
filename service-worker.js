const CACHE_NAME = 'pact-v1';

const PRE_CACHE = [
  '/PACT/',
  '/PACT/index.html',
  '/PACT/js/engine.js',
  '/PACT/manifest.json',
  '/PACT/tools/PACT-CharGen-Webtool.html',
  '/PACT/tools/PACT-Live-Char-Sheet.html',
  '/PACT/tools/DM%20Console.html',
  '/PACT/docs/PACT-Players-Guide.html',
  '/PACT/icons/icon-192.png',
  '/PACT/icons/icon-512.png',
  '/PACT/icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(
      // Icons may not exist yet; skip failures so install doesn't abort
      PRE_CACHE.filter(u => !u.includes('/icons/'))
    )).then(() =>
      caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled(
          PRE_CACHE.filter(u => u.includes('/icons/')).map(u => cache.add(u))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle GET requests for same-origin or GitHub Pages origin
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => {
        // Offline fallback: return index for navigate requests
        if (e.request.mode === 'navigate') return caches.match('/PACT/index.html');
      });
    })
  );
});

// Notify clients a new SW is waiting so they can prompt the user to reload
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
