// ArenaBots service worker — minimal cache-first strategy for the static
// shell so the game launches instantly and works offline (single-player).
// Multiplayer / API requests pass straight through to the network.

const VERSION = 'arenabots-v9';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/assets/logo.svg',
  '/assets/mark.svg',
  '/js/env.js',
  '/js/config.js',
  '/js/store.js',
  '/js/bot.js',
  '/js/builder.js',
  '/js/arena.js',
  '/js/touch.js',
  '/js/shop.js',
  '/js/auth.js',
  '/js/payments.js',
  '/js/net.js',
  '/js/mp.js',
  '/js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Use addAll-with-fallback so a single missing asset doesn't kill install.
    await Promise.all(STATIC_ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* ignore individual failures */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only — never intercept API / Stripe / Colyseus.
  if (url.origin !== location.origin) return;

  // Don't cache API endpoints or websockets.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for the HTML document so deploys propagate quickly.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('/index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match('/index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Cache-first for static assets, with background refresh.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // Refresh in background.
      fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(VERSION).then(c => c.put(req, res.clone())).catch(() => {});
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const cache = await caches.open(VERSION);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (_) {
      return Response.error();
    }
  })());
});
