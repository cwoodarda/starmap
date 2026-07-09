/* sw.js — minimal offline cache so the app works without a connection once
 * loaded. Bump CACHE when assets change. */
const CACHE = 'starmap-v6';
const ASSETS = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './icon.svg', './apple-touch-icon.png',
  './vendor/astronomy.browser.js',
  './js/mat.js', './js/catalog.js', './js/astro.js', './js/sensors.js',
  './js/projection.js', './js/calibration.js', './js/render.js',
  './js/facts.js', './js/info.js', './js/hud.js',
  './js/camera.js', './js/app.js',
  './data/stars.json', './data/constellations.json',
  './data/asterisms.json', './data/dsos.json', './data/descriptions.json',
];

self.addEventListener('install', (e) => {
  // Precache everything, but do NOT auto-activate — wait so the page can prompt
  // the user before swapping in a new version (see 'SKIP_WAITING' below).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('message', (e) => {
  // Page asked us to activate the freshly-installed version now.
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  // Page detected the offline cache was evicted — rebuild it from the network.
  if (e.data === 'RECACHE') {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
