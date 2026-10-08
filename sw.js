// RostiQ service worker: makes the site installable as an app and usable offline.
// - The app's own files: network first (updates arrive immediately), the stored copy when offline.
// - Images: from the store first (they rarely change).
// - Fonts and the Firebase login library: the stored copy right away, refreshed in the background.
// - Team data (Firebase database), maps, weather and place search are never stored here; common.js keeps
//   the last-known team data itself.
const CACHE = "rostiq-v1";
const SHELL = [
  "./", "index.html", "carpool.html", "ploeg.html", "admin.html", "rostiq.html",
  "common.css", "common.js", "i18n.js", "icons.js", "boot.js", "team.js", "config.js", "manifest.webmanifest",
  "assets/rostiq-logo-header.png", "assets/icon-192.png", "assets/icon-512.png", "assets/favicon.png",
  "assets/apple-touch-icon.png", "assets/wordmark-light.png",
];
const SHARED = ["fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes("/__/")) return; // the sign-in helper
    e.respondWith(/\.(png|svg|jpe?g|webp|ico)$/.test(url.pathname) ? cacheFirst(req) : networkFirst(req, url));
  } else if (SHARED.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

// Pages are stored without their ?t=team part: one copy per file is enough.
const keyOf = url => url.origin + url.pathname;

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(keyOf(url), res.clone());
    return res;
  } catch {
    const hit = await cache.match(keyOf(url)) || await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match(new URL("index.html", self.registration.scope).href)) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}
