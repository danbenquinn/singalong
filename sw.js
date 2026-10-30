/* sw.js — the service worker: keeps a copy of the whole site on the phone so it works offline.
   The browser installs this once, then it sits between the page and the network.
   publish.sh rewrites CACHE_VERSION on every publish, so a new version replaces the old copy the
   next time the phone opens the site while online. */

const CACHE_VERSION = 'v1793368769';
const CACHE = 'singalong-' + CACHE_VERSION;

// Everything the page needs. The song list is read and every song file added at install time.
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'songs/index.json'];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    try {
      const list = await (await fetch('songs/index.json', { cache: 'no-cache' })).json();
      await cache.addAll(list.map(f => 'songs/' + f));
      // Timing files (songs/<song>.timing.json) exist only for songs that have been recorded; fetch each, skip misses
      await Promise.all(list.map(async f => {
        const url = 'songs/' + f.replace(/\.txt$/, '.timing.json');
        try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) await cache.put(url, r); } catch (e) {}
      }));
    } catch (e) { /* songs will be cached as they are opened */ }
    self.skipWaiting();
  })());
});

// Throw away older copies
self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    self.clients.claim();
  })());
});

// Network first (so edits show up when online), cached copy when the network is gone.
self.addEventListener('fetch', ev => {
  if (ev.request.method !== 'GET' || !ev.request.url.startsWith(self.location.origin)) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(ev.request);
      if (fresh.ok) cache.put(stripVersion(ev.request), fresh.clone());
      return fresh;
    } catch (e) {
      const hit = await cache.match(stripVersion(ev.request));
      return hit || Response.error();
    }
  })());
});

// index.html links style.css?v=123; store it under plain "style.css" so any stamp finds it
function stripVersion(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}
