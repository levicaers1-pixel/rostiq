// Test server: serves the app from the repo and stands in for the Firebase Realtime Database (REST + live updates),
// with the fake Firebase SDK in ./fake-sdk instead of Google's. No rules are checked here (see tests/rules.test.mjs).
//   node tests/mock/server.cjs                 port 8765, empty database
//   PORT=8770 SEED=tests/out/seed.json node tests/mock/server.cjs
// Options (environment): PORT, SEED (a JSON file loaded as the whole database), PA=1 (the test user is a RostiQ
// platform admin), SLOW=<ms> (every database request waits that long). A file "DB_DOWN" next to this script makes the
// database unreachable (to test offline behaviour). PUT /.json replaces the whole database (the smoke test does that).
const http = require("http"), fs = require("fs"), path = require("path");
const SITE = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT) || 8765;
const SDK = /https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+\//g;
let root = process.env.SEED ? JSON.parse(fs.readFileSync(path.resolve(process.env.SEED), "utf8")) : null;
const clients = [];
const parts = p => p.split("/").filter(Boolean);
function setAt(ps, v) {
  if (!ps.length) { root = v; return; }
  if (!root || typeof root !== "object") root = {};
  let n = root;
  for (const p of ps.slice(0, -1)) { if (!n[p] || typeof n[p] !== "object") n[p] = {}; n = n[p]; }
  const k = ps.at(-1);
  if (v === null) delete n[k]; else n[k] = v;
}
const getAt = ps => ps.reduce((n, k) => (n && typeof n === "object" ? n[k] : undefined), root) ?? null;
const shallow = v => v && typeof v === "object" ? Object.fromEntries(Object.keys(v).map(k => [k, true])) : v;
// Listeners on the changed path's parent get the change as-is; others get a fresh "put" of their whole value.
function notify(ev, p, d) {
  for (const c of clients) {
    const at = "/" + c.ps.join("/");
    if (!c.ps.length) c.write(`event: ${ev}\ndata: ${JSON.stringify({ path: p, data: d })}\n\n`);
    else if (p === at || p.startsWith(at + "/") || at.startsWith(p + "/") || p === "/") c.write(`event: put\ndata: ${JSON.stringify({ path: "/", data: getAt(c.ps) })}\n\n`);
  }
}
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".mjs": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".mp4": "video/mp4" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let p = decodeURIComponent(u.pathname);
  res.setHeader("Access-Control-Allow-Origin", "*");
  // ---- the database ----
  if (p.endsWith(".json") && !p.startsWith("/i18n/")) {
    if (fs.existsSync(path.join(__dirname, "DB_DOWN"))) { req.socket.destroy(); return; }
    const ps = parts(p.slice(0, -5));
    let body = "";
    req.on("data", c => body += c).on("end", () => setTimeout(() => {
      if (req.method === "GET") {
        if (!(req.headers.accept || "").includes("text/event-stream")) {
          const v = getAt(ps);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(u.searchParams.get("shallow") === "true" ? shallow(v) : v));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.write(`event: put\ndata: ${JSON.stringify({ path: "/", data: getAt(ps) })}\n\n`);
        res.ps = ps; clients.push(res);
        res.on("close", () => clients.splice(clients.indexOf(res), 1));
        return;
      }
      const sv = x => x && typeof x === "object" ? (x[".sv"] === "timestamp" ? Date.now() : Object.fromEntries(Object.entries(x).map(([k, y]) => [k, sv(y)]))) : x;
      const v = sv(body ? JSON.parse(body) : null);
      if (req.method === "PATCH") { for (const k in v) setAt([...ps, ...parts(k)], v[k]); notify("patch", "/" + ps.join("/"), v); }
      else { setAt(ps, req.method === "DELETE" ? null : v); notify("put", "/" + ps.join("/"), req.method === "DELETE" ? null : v); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.method === "DELETE" ? null : v));
    }, Number(process.env.SLOW) || 0));
    return;
  }
  // ---- the site, with the fake SDK and a test config ----
  if (p === "/" || p.endsWith("/")) p += "index.html";
  if (p.startsWith("/fake-sdk/")) { res.writeHead(200, { "Content-Type": "application/javascript" }); res.end(fs.readFileSync(path.join(__dirname, p))); return; }
  if (p === "/config.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end((process.env.PA ? 'window.PLATFORM_ADMINS = ["tester@rostiq.test"]; ' : "") +
      `window.FIREBASE_CONFIG = { fake: true }; window.FIREBASE_DB_URL = "http://localhost:${PORT}";`);
    return;
  }
  if (p === "/sw.js") { res.writeHead(404); res.end(); return; } // no offline cache in tests: always the files on disk
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file);
  let data = fs.readFileSync(file);
  if (ext === ".html" || p === "/common.js") data = data.toString("utf8").replace(SDK, "/fake-sdk/");
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  res.end(data);
}).listen(PORT, () => console.log(`RostiQ test server on http://localhost:${PORT}`));
