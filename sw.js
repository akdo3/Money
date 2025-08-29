// ...existing code...
const CACHE_NAME = 'finance-offline-v1';
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './script.js',
  './manifest-icon.png',
  'https://unpkg.com/dexie@3.2.2/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // attempt to add files but ignore failures per-item
      for (const f of FILES) {
        try {
          const url = new URL(f, self.location.href);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            const res = await fetch(url.href, {cache: 'no-cache'});
            if (res && res.ok) await cache.put(url.href, res.clone());
          }
        } catch (e) {
          // ignore individual file caching errors
        }
      }
      // keep a minimal navigation fallback - store index.html as fallback
      try {
        const fallback = await fetch('./index.html', {cache: 'no-cache'});
        if (fallback && fallback.ok) await cache.put(self.registration.scope, fallback.clone());
      } catch(e){}
    } catch (e) {
      // ignore global install errors
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // navigation requests -> try network, fallback to cached index
    if (req.mode === 'navigate') {
      try {
        const networkResp = await fetch(req);
        if (networkResp && networkResp.ok) {
          cache.put(req, networkResp.clone()).catch(()=>{});
          return networkResp;
        }
      } catch (e) {
        const cachedIndex = await cache.match('./index.html') || await cache.match('/');
        if (cachedIndex) return cachedIndex;
        return Response.error();
      }
    }

    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      try {
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          await cache.put(req, res.clone());
        }
      } catch (e) {}
      return res;
    } catch (e) {
      return (await cache.match('./')) || (await cache.match('/')) || Response.error();
    }
  })());
});
