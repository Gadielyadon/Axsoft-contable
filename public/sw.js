// Service worker de AxSoft Contable.
// Objetivo: gastar la menor cantidad de datos posible.
// El diseño y los scripts se guardan en el celular y NO se vuelven a bajar
// hasta que realmente cambien (el número de versión de la URL los renueva).
// Las páginas con datos (ventas, caja, etc.) siempre van a la red.

const CACHE = 'axsoft-v2';
const ESTATICOS = ['/css/styles.css', '/js/app.js', '/manifest.json', '/img/icon.svg'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Borra las versiones anteriores del mismo archivo (para no acumular basura)
function limpiarViejas(cache, pathname, urlActual) {
  cache.keys().then((keys) => {
    keys.forEach((k) => {
      try {
        const u = new URL(k.url);
        if (u.pathname === pathname && k.url !== urlActual) cache.delete(k);
      } catch (err) { /* ignorar */ }
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  const esEstatico = ESTATICOS.includes(url.pathname) || url.pathname.startsWith('/img/');
  if (!esEstatico) return; // páginas con datos: siempre a la red

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((guardado) => {
        // Ya lo tenemos en esta versión: cero datos consumidos.
        if (guardado) return guardado;
        return fetch(req).then((resp) => {
          if (resp && resp.ok) {
            cache.put(req, resp.clone());
            limpiarViejas(cache, url.pathname, req.url);
          }
          return resp;
        }).catch(() =>
          // Sin señal: servimos cualquier versión que tengamos guardada.
          cache.match(req, { ignoreSearch: true })
        );
      })
    )
  );
});
