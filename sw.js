/* ============================================================
   sw.js — para que la aplicación abra aunque el servidor tarde
            o el móvil ande justo de cobertura.

   Sólo se guarda la interfaz (html, css, js e iconos). Las fichas
   NO se cachean nunca: esas se piden siempre al servidor, que es
   quien manda. Así no se ve nunca un dato viejo.
   ============================================================ */
var VERSION = 'taller-v3';
var SHELL = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/store.js',
  './assets/csv.js',
  './assets/shop.js',
  './assets/ui.js',
  './assets/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== VERSION) return caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);

  // datos, cuentas y tiendas: siempre del servidor, nunca de la caché
  if (url.pathname.indexOf('/api/') === 0) return;
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // La interfaz: primero la red (para tener siempre la última versión),
  // y si no hay servidor tiramos de lo guardado.
  e.respondWith(
    fetch(e.request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(VERSION).then(function (cache) { cache.put(e.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
