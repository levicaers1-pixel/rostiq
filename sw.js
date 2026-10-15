// RostiQ service worker: makes the site installable as an app and usable offline.
// - The app's own files: network first (updates arrive immediately), the stored copy when offline.
// - Images: from the store first (they rarely change).
// - Fonts and the Firebase login library: the stored copy right away, refreshed in the background.
// - Team data (Firebase database), maps, weather and place search are never stored here; common.js keeps
//   the last-known team data itself.
const CACHE = "rostiq-v6";
const SHELL = [
  "./", "index.html", "carpool.html", "ploeg.html", "admin.html", "rostiq.html", "start.html", "privacy.html", "me.html", "demo.js",
  "common.css", "common.js", "i18n.js", "i18n/nl.js", "i18n/fr.js", "i18n/en.js", "icons.js", "boot.js", "team.js", "config.js", "manifest.webmanifest",
  "assets/rostiq-logo-header.webp", "assets/icon-192.png", "assets/icon-512.png", "assets/favicon.png",
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
    if (url.pathname.endsWith(".json") || (req.headers.get("accept") || "").includes("text/event-stream")) return; // live data, never cached
    e.respondWith(/\.(png|svg|jpe?g|webp|ico)$/.test(url.pathname) ? cacheFirst(req) : networkFirst(req, url));
  } else if (SHARED.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

// ---- Push notifications (reminders sent by tools/push): data messages, shown here ----
self.addEventListener("push", e => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch {}
  const d = msg.data || msg;
  // Match reminders carry answer buttons: actions = [{ action: "yes", title: "Ja" }, …], links = { yes: url, … }.
  // Browsers show as many as they can (Chrome and Edge: 2, iPhone: none, there a tap opens the answer page).
  const json = s => { try { return JSON.parse(s || "null"); } catch { return null; } };
  const actions = (json(d.actions) || []).filter(a => a && a.action && a.title).slice(0, 3);
  e.waitUntil(self.registration.showNotification(d.title || "RostiQ", {
    body: d.body || "", icon: "assets/icon-192.png", badge: "assets/icon-192.png", tag: d.tag || undefined,
    actions, data: { link: d.link || "./", links: json(d.links) || {} },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  // A button: its own link (which saves that answer); the notification itself: the general link.
  const link = (e.action && data.links && data.links[e.action]) || data.link || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin && "focus" in c);
    if (open) return open.navigate(link).then(c => (c || open).focus());
    return self.clients.openWindow(link);
  }));
});

// Pages are stored without their ?t=team part: one copy per file is enough.
const keyOf = url => url.origin + url.pathname;

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    // "no-cache": always ask the server whether there's a newer version (GitHub Pages lets browsers keep files
    // 10 minutes), so a new page never runs with an older script right after an update.
    const res = await fetch(url.href, { cache: "no-cache", credentials: "same-origin" });
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
