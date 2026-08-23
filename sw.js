const CACHE_VERSION = "v2";
const CACHE_NAME = `scheduler-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "nlp.js",
  "ocr.js",
  "holidays.js",
  "manifest.json",
  "assets/icon.svg",
  "assets/favicon.svg"
];

const VENDOR_TESSERACT_PATH = new URL("vendor/tesseract/", self.location).pathname;
const INDEX_URL = new URL("index.html", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith(VENDOR_TESSERACT_PATH)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  await cacheSuccessfulResponse(cache, request, response);
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    await cacheSuccessfulResponse(cache, request, response);
    return response;
  } catch (error) {
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    if (request.mode === "navigate" || request.destination === "document") {
      const cachedIndex = await cache.match(INDEX_URL);

      if (cachedIndex) {
        return cachedIndex;
      }
    }

    throw error;
  }
}

async function cacheSuccessfulResponse(cache, request, response) {
  if (response.ok) {
    await cache.put(request, response.clone());
  }
}
