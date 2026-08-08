const CACHE_NAME = 'neologix-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './favicon.png',
  './logo-full.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap',
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
