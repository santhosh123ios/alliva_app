const CACHE = 'alliva-v2';

self.addEventListener('install', (event) => {
  // Take over from an older worker straight away instead of waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  // Offline, a page falls back to the cached app shell. Never answer with nothing: Safari shows
  // "Returned response is null" and the page cannot open at all.
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = (await caches.match(request)) ?? (request.mode === 'navigate' ? await caches.match('/') : undefined);
      return cached ?? Response.error();
    }),
  );
});
