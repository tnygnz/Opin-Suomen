/* Çevrimdışı önbellek (service worker)
 *
 * Kurulumda uygulama kabuğu önbelleğe alınır. Gezinme istekleri ağ-öncelikli
 * (HTML taze kalsın, ağ yoksa önbellek), statik varlıklar önbellek-öncelikli ve
 * arka planda tazelenir (stale-while-revalidate). Sürüm değişince eski
 * önbellekler silinir; bu yüzden dosya değişikliklerinde CACHE adını artır.
 */

const CACHE = "suomi-tr-v6";

const CORE = [
  "./",
  "index.html",
  "manifest.json",
  "assets/styles.css",
  "assets/app.js",
  "assets/data.js",
  "assets/store.js",
  "assets/srs.js",
  "assets/fsrs.js",
  "assets/reading.js",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
];

// Yeni sürüm kurulunca hemen devreye girmez: sayfa "Yenile" diyene kadar bekler.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** Yanıtı önbelleğe yazar; hata olsa bile yanıtı bozmadan döndürür. */
function cachePut(request, response) {
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cachePut(request, response))
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match("index.html") || caches.match("./"))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => (response && response.status === 200 ? cachePut(request, response) : response))
        .catch(() => hit);
      return hit || network;
    })
  );
});
