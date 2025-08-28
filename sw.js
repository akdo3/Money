// ...existing code...
const CACHE_NAME = 'finance-offline-v1';
const FILES = [
  './',
  './index.html',
  './manifest.json',
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
          // only fetch http/https (and relative) resources
          const url = new URL(f, self.location.href);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            const res = await fetch(url.href, {cache: 'no-cache'});
            if (res && res.ok) await cache.put(url.href, res.clone());
          }
        } catch (e) {
          // ignore individual file caching errors
        }
      }
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

  // ignore non-http(s) requests and data: / chrome-extension: etc.
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      // only cache same-origin && ok responses to avoid unsupported schemes/errors
      try {
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          await cache.put(req, res.clone());
        }
      } catch (e) {
        // ignore cache.put errors
      }
      return res;
    } catch (e) {
      // fallback to root cached page if available
      return (await cache.match('./')) || (await cache.match('/')) || Response.error();
    }
  })());
});
