'use strict';
const CACHE = 'clipspro-36200b2d46';
const FILES = [
  "./",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "index.html",
  "js/app.js",
  "js/cuts.js",
  "js/dialogs.js",
  "js/editor.js",
  "js/keys.js",
  "js/media.js",
  "js/menu.js",
  "js/mp4-muxer.min.js",
  "js/player.js",
  "js/ranges.js",
  "js/timeline.js",
  "js/tracker.js",
  "js/util.js",
  "js/webexport.js",
  "js/webm-muxer.min.js",
  "manifest.webmanifest",
  "style.css",
  "version.json",
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // the app shell: serve from cache, refresh in the background so updates arrive on next launch
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
  }));
});
