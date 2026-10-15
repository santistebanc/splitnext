/* global cacheName, appAssets */

// The build prepends the release cache name and immutable public asset URLs.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);

      await cache.addAll(appAssets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();

      await Promise.all(
        names.map((name) => {
          if (name.startsWith('splitnext-app-shell-') && name !== cacheName)
            return caches.delete(name);

          return Promise.resolve(false);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (
    request.mode === 'navigate' &&
    (url.pathname === '/app' ||
      url.pathname === '/app/' ||
      url.pathname === '/')
  ) {
    event.respondWith(navigate(request, url.pathname === '/' ? '/' : '/app'));
  } else if (
    url.pathname.startsWith('/_expo/static/') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(asset(request));
  }
  // API requests and invitation previews are never cached.
});

async function navigate(request, path) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(
      new Request(request, { signal: AbortSignal.timeout(3000) }),
    );

    if (response.ok) await cache.put(path, response.clone());

    return response;
  } catch (error) {
    const cached = await cache.match(path);

    if (cached) return cached;

    throw error;
  }
}

async function asset(request) {
  const cache = await caches.open(cacheName);

  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request);

  if (response.ok) await cache.put(request, response.clone());

  return response;
}
