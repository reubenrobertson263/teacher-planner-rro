const CACHE_NAME = 'flowdesk-cache-v1';
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
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : { title: 'FlowDesk Alert', body: 'Upcoming Timetable Period' };
  const options = { body: data.body, icon: '/icon.png', badge: '/badge.png', vibrate: [200, 100, 200, 100, 200] };
  event.waitUntil(self.registration.showNotification(data.title, options));
});
