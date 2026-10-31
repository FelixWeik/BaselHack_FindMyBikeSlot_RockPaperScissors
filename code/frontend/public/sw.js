// The registration URL carries the build id, so every deploy installs a new worker.
const VERSION = new URL(self.location).searchParams.get("v") || "dev";
const CACHE = `bikespot-${VERSION}`;
const PAGES = ["/", "/map", "/forecast", "/settings", "/privacy", "/admin"];
const EXTRAS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(EXTRAS.map((u) => cache.add(u).catch(() => {})));
  const assets = new Set();
  await Promise.all(
    PAGES.map(async (page) => {
      const res = await fetch(page, { cache: "no-cache" });
      if (!res.ok) return;
      await cache.put(page, res.clone());
      // Every chunk a page references is cached up front, otherwise offline navigation breaks.
      for (const [path] of (await res.text()).matchAll(/\/_next\/static\/[^"'\\\s)]+/g)) assets.add(path);
    }),
  );
  await Promise.all([...assets].map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener("install", (event) => event.waitUntil(precache()));

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function pageNetworkFirst(req, url) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(url.pathname, res.clone());
    return res;
  } catch {
    return (await caches.match(url.pathname)) || (await caches.match("/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Live data is never cached here: a stale answer would look fresh to the app,
  // which keeps its own timestamped copy for offline use.
  if (url.pathname.startsWith("/api/")) return;
  // React Server Component payloads: when they fail, Next falls back to a full navigation.
  if (url.searchParams.has("_rsc") || req.headers.get("RSC")) return;

  if (isStatic(url)) event.respondWith(cacheFirst(req));
  else if (req.mode === "navigate") event.respondWith(pageNetworkFirst(req, url));
});
