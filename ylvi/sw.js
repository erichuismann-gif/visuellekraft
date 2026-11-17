// Cache für die App-Dateien, damit sie schnell startet.
// Nur eigene Dateien werden gecacht – Datenbank-Anfragen gehen immer ins Netz.
const CACHE = 'ylvi-klo-v5';
const FILES = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg', './meds.js', './pdf-export.js', './vendor/jspdf.umd.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst, damit Updates sofort ankommen; ohne Netz aus dem Cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // cache: 'no-cache' – immer beim Server nachfragen, damit nach Updates
  // keine alten Dateien aus dem Browser-Cache gemischt werden.
  e.respondWith(
    fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
