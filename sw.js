/* Service Worker — cache offline para PWA */

const CACHE_NAME = 'habits-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
];

// Instalar: cachear archivos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first para archivos de la app, cache como respaldo offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No cachear llamadas a Supabase
  if (url.hostname.includes('supabase')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first: intenta red, si falla usa cache
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request);
    })
  );
});
