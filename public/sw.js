const CACHE_NAME = 'flowdesk-pa-20261027-10';
const LOCAL_ASSETS = [
  '/', '/index.html', '/pa.html', '/js/pa-home.js', '/pa.webmanifest', '/pa-icon.svg',
  '/hub.html', '/css/hub.css', '/js/hub.js',
  '/name-trainer.html', '/css/name-trainer.css', '/js/name-trainer-standalone.js',
  '/css/lesson-studio.css', '/js/lesson-model.js', '/js/lesson-import.js', '/js/lesson-template.js', '/js/lesson-workspace.js', '/views/lesson-workspace.html',
  '/js/app.js','/js/router.js','/js/settings.js','/js/arbor-worker.js','/js/timetable.js','/js/dashboard.js','/js/planbook.js','/js/seating.js','/js/markbook.js','/js/nametrainer.js','/js/aistudio.js','/js/assistant.js','/js/task.js','/js/admin.js',
  '/views/settings.html','/views/timetable.html','/views/dashboard.html','/views/planbook.html','/views/seating.html','/views/markbook.html','/views/nametrainer.html','/views/aistudio.html','/views/tasks.html','/views/admin.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('flowdesk-') && key !== CACHE_NAME).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    const page = ['/hub.html', '/name-trainer.html'].includes(url.pathname) ? url.pathname : '/index.html';
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(page, copy)); }
      return response;
    }).catch(() => caches.match(page)));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request)));
  }
});
