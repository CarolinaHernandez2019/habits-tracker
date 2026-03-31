/* Service Worker — cache offline para PWA */

const CACHE_NAME = 'habits-v3';

// Assets esenciales (deben existir siempre)
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
];

// Assets opcionales (pueden no existir en todos los entornos)
const OPTIONAL_ASSETS = [
  './config.js',
];

// Instalar: cachear esenciales, intentar opcionales sin romper
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_ASSETS);
      // config.js puede no existir en algunos entornos; si falla, no bloquea
      for (const asset of OPTIONAL_ASSETS) {
        try { await cache.add(asset); } catch (e) { /* ignorar */ }
      }
    })
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

  // No cachear llamadas a Supabase ni a CDNs externos
  if (url.hostname.includes('supabase') || url.hostname.includes('cdn.jsdelivr.net')) {
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
