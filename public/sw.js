// Service worker mínimo: cachea los estáticos para que abra rápido.
// Las páginas con datos siempre van a la red (los datos viven en el servidor).
const CACHE = 'axsoft-v1';
const ASSETS = ['/css/styles.css', '/js/app.js', '/manifest.json', '/img/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Solo cacheamos estáticos del mismo origen; el resto va a la red.
  if (req.method === 'GET' && ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
