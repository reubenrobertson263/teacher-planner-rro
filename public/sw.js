const CACHE_NAME = 'flowdesk-v1-qa-20260831-2';
const LOCAL_ASSETS = [
  '/', '/index.html',
  '/js/app.js','/js/router.js','/js/settings.js','/js/timetable.js','/js/dashboard.js','/js/planbook.js','/js/seating.js','/js/markbook.js','/js/nametrainer.js','/js/aistudio.js','/js/task.js','/js/admin.js',
  '/views/settings.html','/views/timetable.html','/views/dashboard.html','/views/planbook.html','/views/seating.html','/views/markbook.html','/views/nametrainer.html','/views/aistudio.html','/views/tasks.html','/views/admin.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy)); return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(cached => {
      const update = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || update;
    }));
  }
});
