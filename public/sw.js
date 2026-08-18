const CACHE_NAME = 'flowdesk-cache-v2'; // Version bump forces cache refresh
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS/libs/jszip.min.js',
  'https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS/dist/pptxgen.min.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
});

// NETWORK-FIRST STRATEGY: Always get the newest code from Render. Fall back to cache only if offline.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : { title: 'FlowDesk Alert', body: 'Notification' };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon.png', badge: '/badge.png', vibrate: [200, 100, 200] }));
});
