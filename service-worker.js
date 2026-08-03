const CACHE_NAME = 'pact-v8';   // v8: purge caches holding a pre-isCloudCharId character-store.js (see below)

const PRE_CACHE = [
  '/PACT/',
  '/PACT/index.html',
  '/PACT/login.html',
  '/PACT/js/engine.js',
  '/PACT/js/engine-data.js',
  '/PACT/js/character-store.js',
  '/PACT/js/supabase-client.js',
  // Version-pinned vendor build: cache-first is SAFE here precisely because the filename carries the
  // version, so an update is a different URL and can never be served stale against a newer caller.
  '/PACT/js/vendor/supabase-js-2.110.2.js',
  '/PACT/js/auth.js',
  '/PACT/js/sync.js',
  '/PACT/js/campaign.js',
  '/PACT/js/dm.js',
  '/PACT/js/feedback.js',
  '/PACT/js/ui-helpers.js',
  '/PACT/js/ap-by-level.js',
  '/PACT/js/advancement.js',
  '/PACT/manifest.json',
  '/PACT/tools/PACT-CharGen-Webtool.html',
  '/PACT/tools/PACT-Live-Char-Sheet.html',
  '/PACT/tools/DM-Console.html',
  '/PACT/docs/PACT-Players-Guide.html',
  '/PACT/icons/icon-192.png',
  '/PACT/icons/icon-512.png',
  '/PACT/icons/apple-touch-icon.png',
];

// Network-first: HTML pages, engine.js + engine-data.js (the rules dataset — REV-14a moved it out of
// engine.js, and it must keep engine.js's immediate-propagation semantics so a rules fix reaches
// returning users right away rather than sticking on a stale cached copy), the auth/sync/campaign/dm
// client modules, and ui-helpers.js/ap-by-level.js/advancement.js — added 2026-07-19, same reasoning as
// the modules above: ui-helpers.js holds esc(), the shared XSS-escaping helper all three tools call, so
// a fix there needs to reach returning users immediately, not sit stale until the next CACHE_NAME bump;
// ap-by-level.js/advancement.js are the pricing-curve data these tools price against, same propagation
// need. So deployed fixes reach returning users immediately (see
// D-GH-2026-07-16-sw-network-first-security-modules — this fetch handler already falls back to the cached
// copy on failure, so widening this list costs nothing in offline capability, only speeds up fix
// propagation for online users).
// character-store.js was added to this list on 2026-08-03, and the reason is a bug worth remembering.
// It was cache-first while js/sync.js (network-first) began importing `isCloudCharId` from it. Returning
// users therefore got TODAY's sync.js against YESTERDAY's cached character-store.js — and a named ES
// import that the target module doesn't export is a LINK-TIME failure, so the whole module graph refused
// to instantiate. The cloud bridge died on every normal page load while the engine bridge (which only
// imports names that already existed) linked fine, producing a rendered-but-cloud-less app: empty "My
// Characters", invites never redeemed, "Sign in for campaign rules" while signed in. A hard refresh
// bypasses the SW and fetched a fresh copy, which is why it "worked after a hard refresh".
//
// THE RULE THIS ENCODES: a module imported by any network-first module must ITSELF be network-first.
// Mixed freshness across an import edge is not a caching trade-off, it is a broken build. testing/
// scripts/audit.py now enforces this so it can't be reintroduced by adding an innocent-looking import.
// Everything else (icons, feedback.js) stays cache-first for speed.
const NETWORK_FIRST_RE = /\.html$|\/PACT\/$|\/js\/(engine|engine-data|character-store|auth|supabase-client|sync|campaign|dm|ui-helpers|ap-by-level|advancement)\.js$/;

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
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never intercept cross-origin requests (Supabase API, esm.sh CDN, etc.)
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (NETWORK_FIRST_RE.test(url.pathname)) {
    // Network-first: try the network; serve cached copy only when offline.
    // cache:'no-store' bypasses the browser's/CDN's ordinary HTTP cache — without it, this fetch
    // can silently return a stale response even though the SW strategy is "network-first".
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(e.request).then(cached =>
          cached || (e.request.mode === 'navigate' ? caches.match('/PACT/index.html') : null)
        )
      )
    );
    return;
  }

  // Cache-first for everything else (icons, supporting JS files).
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('/PACT/index.html');
      });
    })
  );
});

// Notify clients a new SW is waiting so they can prompt the user to reload
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
