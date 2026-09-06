const CACHE_PREFIX = "fixed-income-tracker-static";
const CACHE_NAME = `${CACHE_PREFIX}-v1`;
const CORE_ASSETS = ["/app-icon.svg", "/app-icon-192.png", "/app-icon-512.png", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated HTML, API responses, or private documents.
  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  const isStaticAsset = CORE_ASSETS.includes(url.pathname)
    || url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/assets/");
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
