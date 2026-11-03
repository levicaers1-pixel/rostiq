// Smoke test: opens every main page as a signed-in user, on a phone (light and dark) and a desktop, against the test
// server with the test teams of fixtures.mjs. Fails on: script errors, pages that don't finish loading, content that
// should be there but isn't, text that shouldn't be there (raw text keys, "undefined", selections when they're off),
// and layout wider than the screen. Screenshots go to tests/out/. Uses the Edge (or Chrome) already on this computer.
//   cd tests && npm run smoke            (ONLY=fresh to run only pages whose name contains "fresh")
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { seed, USER, QUICK_KEY } from "./fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const PORT = 8770, BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

// Every text key (to catch a key shown instead of its text).
const ctx = { T: {}, plural: (n, a, b) => (n === 1 ? a : b), window: {} };
vm.createContext(ctx);
for (const l of ["nl", "fr", "en"]) vm.runInContext(fs.readFileSync(path.join(HERE, "../i18n", l + ".js"), "utf8"), ctx);
const KEYS = Object.keys(ctx.T.nl).filter(k => /^[a-z]+\.[a-zA-Z.]+$/.test(k));

const data = seed();
const dates = t => Object.keys(data.teams[t].schedule).sort();
const next = t => dates(t).find(d => d >= new Date().toLocaleDateString("sv-SE"));

// ---- the checks, run inside the page ----
const vis = `const vis = el => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";`;
const PAGES = [
  { name: "fresh-home", url: "/?t=fresh", check: `${vis}
      const r = [];
      if (!vis(document.getElementById("hero"))) r.push("match card missing");
      if (!vis(document.getElementById("welcome"))) r.push("welcome checklist missing");
      if (/selecti|opstelling/i.test(document.querySelector("main").innerText)) r.push("selection text while selections are off");
      if (document.querySelector("#hero .md-x small") && document.querySelector("#hero .md-x small").textContent.trim()) r.push("home/away shown for golf");
      return r;` },
  { name: "fresh-kalender", url: "/?t=fresh#kalender", check: `
      const n = document.querySelectorAll("#matches .match").length;
      return n === ${dates("fresh").length} ? [] : ["Kalender shows " + n + " of ${dates("fresh").length} matches"];` },
  { name: "fresh-match", url: `/?t=fresh#m/${next("fresh")}`, check: `
      const tabs = [...document.querySelectorAll(".mp-tabs button")].map(b => b.dataset.mt).join("");
      return tabs === "och" ? [] : ["match page tabs: " + tabs + " (expected och: no line-up when selections are off)"];` },
  { name: "full-home", url: "/?t=full", check: `${vis}
      const r = [];
      if (!vis(document.getElementById("hero"))) r.push("match card missing");
      if (!vis(document.getElementById("news"))) r.push("announcement missing");
      if (!document.querySelector("#hero [data-answer][aria-pressed=true]")) r.push("chosen answer not marked on the match card");
      return r;` },
  { name: "full-kalender", url: "/?t=full#kalender", check: `${vis}
      const r = [], n = document.querySelectorAll("#matches .match").length;
      if (n < 3) r.push("Kalender shows " + n + " matches");
      if (!vis(document.getElementById("cal-filters"))) r.push("filters missing");
      return r;` },
  ...["o", "l", "c", "h"].map(tab => ({ name: "full-match-" + tab, url: `/?t=full#m/${next("full")}/${tab}`, check: `
      const p = document.querySelector(".mp-pane");
      return p && p.innerText.trim().length > 10 ? [] : ["match page tab ${tab} is empty"];` })),
  { name: "full-ploeg", url: "/ploeg.html?t=full", check: `
      const n = document.querySelectorAll("#grid .card").length;
      return n === 6 ? [] : ["Ploeg shows " + n + " of 6 players"];` },
  { name: "full-carpool", url: "/carpool.html?t=full", check: `
      return document.querySelector(".cp-route") ? [] : ["no carpool overview"];` },
  { name: "full-admin", url: "/admin.html?t=full", check: `${vis}
      return vis(document.querySelector(".hub-health")) ? [] : ["admin overview missing"];` },
  { name: "full-admin-players", url: "/admin.html?t=full#sec-players", check: `${vis}
      const shown = [...document.querySelectorAll("#admin > section.panel")].filter(vis).map(s => s.id);
      return shown.join() === "sec-players" ? [] : ["admin section view shows: " + shown.join()];` },
  { name: "fresh-admin-settings", url: "/admin.html?t=fresh#sec-settings", check: `
      const f = document.getElementById("f-settings"), r = [];
      if (!f) return ["settings form missing"];
      if (f.selOn.checked) r.push("'Make selections' is on, but the team switched it off");
      if (f.homeAway.checked) r.push("home/away is on for golf");
      return r;` },
  { name: "golf-ranking", url: "/?t=golf#ranking", check: `${vis}
      const r = [], rows = [...document.querySelectorAll(".rk-row")];
      const got = rows.map(x => x.querySelector(".nm b").textContent.split(" ")[0] + ":" + x.querySelector(".rk").textContent + ":" + x.querySelector(".pt b").textContent).join(" ");
      if (got !== "Test:1:43 Jonas:2:43 Jens:3:30 Arnaud:4:24") r.push("ranking: " + got);
      if (!vis(document.querySelector(".rk-pod.p1"))) r.push("podium missing");
      const hist = document.querySelectorAll(".rk-hist a").length;
      if (hist !== 2) r.push("played matches on the Ranking: " + hist + " of 2");
      if (![...document.querySelectorAll(".rank-tab")].some(vis)) r.push("Ranking tab not shown for a golf team");
      return r;` },
  { name: "golf-result-admin", url: `/?t=golf#m/${dates("golf")[1]}/r`, check: `
      const r = [], calc = [...document.querySelectorAll("[data-sc-calc]")].map(x => x.textContent.replace(/\s+/g, " ").trim());
      if (calc.length !== 4) r.push("score entry shows " + calc.length + " of 4 players");
      if (!calc.some(x => x.startsWith("72") && x.includes("· 18"))) r.push("no live place/points for the tie at 72: " + calc.join(" | "));
      if (!document.querySelector("[data-sc-f=net][aria-pressed=true]")) r.push("saved format (net) not selected");
      return r;` },
  { name: "golf-ranking-history", url: "/?t=golf#ranking", setup: "noScores", check: `${vis}
      const r = [], links = [...document.querySelectorAll(".rk-hist a")];
      if (links.length !== 2) r.push("played matches without results: " + links.length + " of 2");
      if (!links.every(a => a.querySelector(".go:not(.done)"))) r.push("no 'enter scores' button for the admin");
      if (!links.every(a => (a.getAttribute("href") || "").startsWith("#m/") && a.getAttribute("href").endsWith("/r"))) r.push("links don't open the Result tab");
      return r;` },
  { name: "full-no-ranking", url: "/?t=full", check: `${vis}
      return [...document.querySelectorAll(".rank-tab")].some(vis) ? ["Ranking tab shown for a hockey team"] : [];` },
  { name: "profile", url: "/me.html", check: `${vis}
      const r = [];
      if (!vis(document.querySelector(".pf"))) r.push("profile card missing");
      const n = document.querySelectorAll(".pf-team").length;
      if (n !== 3) r.push("profile shows " + n + " of 3 teams");
      return r;` },
  { name: "answer-link", url: `/a/?${QUICK_KEY}`, check: `
      return document.querySelectorAll(".q-card").length ? [] : ["answer page shows no matches"];` },
];
// The same for every page: no raw keys, no "undefined", nothing wider than the screen.
const GENERIC = `
  const r = [], text = document.body.innerText;
  const keys = ${JSON.stringify(KEYS)}.filter(k => text.includes(k));
  if (keys.length) r.push("raw text keys: " + keys.slice(0, 5).join(", "));
  const bad = text.match(/\\bundefined\\b|\\bNaN\\b|\\[object Object\\]/);
  if (bad) r.push("shows '" + bad[0] + "'");
  const over = document.documentElement.scrollWidth - innerWidth;
  if (over > 1) r.push("page is " + over + "px wider than the screen");
  return r;`;

// ---- run ----
const server = spawn(process.execPath, [path.join(HERE, "mock/server.cjs")], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, fail) => { server.stdout.once("data", ok); server.once("exit", c => fail(new Error("test server stopped: " + c))); });
const put = () => fetch(`${BASE}/.json`, { method: "PUT", body: JSON.stringify(seed()) });
await put();

let browser;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
if (!browser) { console.error("No Edge or Chrome found on this computer."); server.kill(); process.exit(2); }

const RUNS = [
  { label: "phone-light", viewport: { width: 375, height: 812 }, theme: "light" },
  { label: "phone-dark", viewport: { width: 375, height: 812 }, theme: "dark" },
  { label: "desktop", viewport: { width: 1280, height: 900 }, theme: "light" },
];
const only = process.env.ONLY || "";
const failures = [];
let checked = 0;
for (const run of RUNS) {
  const context = await browser.newContext({ viewport: run.viewport, locale: "nl-BE", serviceWorkers: "block" });
  await context.addInitScript(([user, theme]) => {
    try {
      localStorage.setItem("fakeUser", JSON.stringify(user));
      localStorage.setItem("lang", "nl");
      if (theme === "dark") localStorage.setItem("theme", "dark"); else localStorage.removeItem("theme");
      localStorage.setItem("pushLater", String(Date.now())); // no notification question in the screenshots
    } catch {}
  }, [USER, run.theme]);
  for (const pg of PAGES.filter(p => p.name.includes(only))) {
    await put(); // every page starts from the same data
    if (pg.setup === "noScores") await fetch(`${BASE}/teams/golf/scores.json`, { method: "DELETE" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push("script error: " + e.message));
    page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon|fonts\.g/i.test(m.text())) errors.push("console: " + m.text().slice(0, 200)); });
    page.on("response", r => { if (r.status() === 404 && r.url().startsWith(BASE) && !/sw\.js|favicon/.test(r.url())) errors.push("404: " + r.url().slice(BASE.length)); });
    try {
      await page.goto(BASE + pg.url, { waitUntil: "domcontentloaded" });
      // Loaded: the team pages say "live"; the others just need a moment.
      await page.waitForFunction(() => { const s = document.getElementById("status"); return !s || /live/.test(s.className); }, null, { timeout: 8000 })
        .catch(() => errors.push("never got live data (status: " + "not live" + ")"));
      await page.waitForTimeout(700);
      const found = [...await page.evaluate(new Function(pg.check)), ...await page.evaluate(new Function(GENERIC))];
      errors.push(...found);
      await page.screenshot({ path: path.join(OUT, `${run.label}-${pg.name}.png`) });
    } catch (e) { errors.push("could not test: " + e.message.split("\n")[0]); }
    checked++;
    if (errors.length) failures.push({ where: `${run.label} ${pg.name}`, errors: [...new Set(errors)] });
    console.log(`${errors.length ? "✗" : "✓"} ${run.label.padEnd(12)} ${pg.name}${errors.length ? "\n    " + [...new Set(errors)].join("\n    ") : ""}`);
    await page.close();
  }
  await context.close();
}
// ---- reopening the app: the stored team shows before the sign-in library is ready, and only for the same account ----
async function reopen(name, change, expectTeam) {
  if (only && !("reopen-" + name).includes(only)) return;
  await put();
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "nl-BE", serviceWorkers: "block" });
  await context.addInitScript(user => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");
    localStorage.setItem("fakeUser", JSON.stringify(user)); localStorage.setItem("lang", "nl"); localStorage.setItem("pushLater", String(Date.now())); } } catch {} }, USER);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push("script error: " + e.message));
  try {
    await page.goto(BASE + "/?t=full", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /live/.test((document.getElementById("status") || {}).className), null, { timeout: 8000 });
    await page.waitForTimeout(2000); // the stored copy is written 1.5 s after the data
    await page.evaluate(change);
    let release;
    const held = new Promise(ok => { release = ok; });
    await page.route("**/firebase-auth.js", async r => { await held; await r.continue(); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const early = await page.evaluate(`${vis} vis(document.getElementById("hero")) && !!document.querySelector("#hero [data-answer][aria-pressed=true]")`);
    if (expectTeam && !early) errors.push("the stored team didn't show before sign-in was ready");
    release();
    await page.waitForTimeout(1500);
    const after = await page.evaluate(`${vis} vis(document.getElementById("hero"))`);
    if (expectTeam && !after) errors.push("the team disappeared after sign-in");
    if (!expectTeam && after) errors.push("another account's stored team stayed visible");
    await page.screenshot({ path: path.join(OUT, `reopen-${name}.png`) });
  } catch (e) { errors.push("could not test: " + e.message.split("\n")[0]); }
  checked++;
  if (errors.length) failures.push({ where: "reopen " + name, errors });
  console.log(`${errors.length ? "✗" : "✓"} reopen       ${name}${errors.length ? "\n    " + errors.join("\n    ") : ""}`);
  await context.close();
}
await reopen("same-account", () => {}, true);
await reopen("signed-out", () => localStorage.removeItem("fakeUser"), false);

// ---- plans: with the plans previewed on this device, a team without Pro sees Free; the trial and a pilot plan unlock it ----
async function plans(name, billing, url, test, extra) {
  if (only && !("plans-" + name).includes(only)) return;
  await put();
  await fetch(`${BASE}/billing/golf.json`, { method: "PUT", body: JSON.stringify(billing) }); // null: no plan, so Free
  if (extra) await fetch(`${BASE}/.json`, { method: "PATCH", body: JSON.stringify(extra) });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "nl-BE", serviceWorkers: "block" });
  await context.addInitScript(user => { try { localStorage.setItem("fakeUser", JSON.stringify(user)); localStorage.setItem("lang", "nl");
    localStorage.setItem("pushLater", String(Date.now())); localStorage.setItem("plansPreview", "1"); } catch {} }, USER);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push("script error: " + e.message));
  try {
    await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => { const s = document.getElementById("status"); return s ? /live/.test(s.className) : !document.querySelector(".skel-card"); }, null, { timeout: 8000 });
    await page.waitForTimeout(900);
    errors.push(...await test(page));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `plans-${name}.png`) });
  } catch (e) { errors.push("could not test: " + e.message.split("\n")[0]); }
  checked++;
  if (errors.length) failures.push({ where: "plans " + name, errors });
  console.log(`${errors.length ? "✗" : "✓"} plans        ${name}${errors.length ? "\n    " + errors.join("\n    ") : ""}`);
  await context.close();
}
const shown = sel => `${vis} vis(document.querySelector(${JSON.stringify(sel)}))`;
await plans("free-ranking-trial", null, "/?t=golf#ranking", async page => {
  const r = [];
  if (!await page.evaluate(shown("#view-rank .pro-lock"))) r.push("Free: the ranking isn't locked");
  await page.screenshot({ path: path.join(OUT, "plans-free-ranking.png") });
  await page.click("#view-rank [data-pro-open]");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "plans-free-prowindow.png") });
  if (!await page.evaluate(shown('#pro-dlg [data-pro="trial"]'))) return [...r, "no trial button in the Pro window"];
  await page.click('#pro-dlg [data-pro="trial"]');
  await page.waitForTimeout(800);
  const b = await fetch(`${BASE}/billing/golf.json`).then(x => x.json());
  if (!b || !(b.trial > Date.now() + 29 * 864e5)) r.push("the trial wasn't saved: " + JSON.stringify(b));
  if (await page.evaluate(shown("#view-rank .pro-lock"))) r.push("the ranking is still locked during the trial");
  return r;
});
await plans("free-admin", null, "/admin.html?t=golf#sec-backup", async page => {
  const r = [];
  if (!await page.evaluate(`!!document.querySelector("#f-settings .sel-pro .pro-tag")`)) r.push("no Pro label at 'make selections'");
  await page.click("#backup");
  if (!await page.evaluate(shown("#pro-dlg"))) r.push("backup on Free didn't open the Pro window");
  return r;
});
// A big team on Free: a hint about Pro above the players, nothing blocked; no hint on Pro.
const BIG = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`teams/golf/players/big${i}`, { name: `Speler ${i + 1}` }]));
await plans("free-big-team", null, "/admin.html?t=golf#sec-players", async page => {
  const r = [];
  if (!await page.evaluate(shown("#big-bar"))) r.push("Free with 30+ players: no hint about Pro");
  await page.click("#big-bar [data-pro-open]");
  if (!await page.evaluate(shown("#pro-dlg"))) r.push("the big-team hint didn't open the Pro window");
  return r;
}, BIG);
await plans("pro-big-team", { plan: "pro", until: "2099-12-31", src: "paid" }, "/admin.html?t=golf#sec-players", async page =>
  await page.evaluate(shown("#big-bar")) ? ["Pro: the big-team hint is shown"] : [], BIG);
// A team's own logo and colours: hidden on Free (the team name as text, RostiQ's colours), back with Pro.
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OWN = { "teams/golf/info/logo": LOGO, "teams/golf/info/colors": { main: "#123456", highlight: "#abcdef", light: { "--brand": "#123456" }, dark: { "--brand": "#0a0a0a" } } };
const header = `({ img: !!document.querySelector(".brand-inner > a img.logo"), brand: getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() })`;
await plans("free-own-logo", null, "/?t=golf", async page => {
  const h = await page.evaluate(header), r = [];
  if (h.img) r.push("Free: the team's own logo is still shown");
  if (h.brand === "#123456") r.push("Free: the team's own colours are still used");
  return r;
}, OWN);
await plans("pro-own-logo", { plan: "pro", until: "2099-12-31", src: "paid" }, "/?t=golf", async page => {
  const h = await page.evaluate(header);
  return [!h.img && "Pro: the team's own logo is missing", h.brand !== "#123456" && "Pro: the team's own colours are missing: " + h.brand].filter(Boolean);
}, OWN);
// The club page: numbers per team for the club's people responsible; the "Club" item in their account menu.
const CLUB_STATS = { at: Date.now(), active: 84, players: 105, cents: 50400, teams: {
  golf: { name: "Golf Ranking Club", sport: "golf", players: 19, linked: 18, active: 18, never: 1, next: { date: "2099-01-01", opp: "Rivalen", answered: 15 } },
  full: { name: "Hockey Heren", sport: "hockey", players: 17, linked: 10, active: 8, never: 9 } } };
await plans("club-page", null, "/club.html", async page => {
  const r = [], text = await page.evaluate(`document.getElementById("club-body").innerText`);
  if (await page.evaluate(`document.getElementById("club-title").textContent`) !== "KHC Proef") r.push("club name missing");
  for (const want of ["84", "504", "Golf Ranking Club", "18 / 19", "8 / 17", "9 nog nooit geantwoord"]) if (!text.includes(want)) r.push("club page lacks " + want);
  await page.click("#acct-btn").catch(() => {});
  if (!await page.evaluate(`!!document.querySelector('#acct-menu a[href*="club.html"]')`)) r.push("no Club item in the account menu");
  return r;
}, { "clubs/khc": { name: "KHC Proef", until: "2099-06-30", teams: { golf: true, full: true }, admins: { [USER.uid]: true }, stats: CLUB_STATS },
     [`clubAdmins/${USER.uid}/khc`]: true });
const CLUB_DB = { "clubs/khc": { name: "KHC Proef", until: "2099-06-30", teams: { golf: true, full: true }, admins: { [USER.uid]: true }, stats: CLUB_STATS },
  [`clubAdmins/${USER.uid}/khc`]: true,
  "teams/golf/schedule/2099-03-01": { opp: "Thuisclub A", home: true }, "teams/golf/matches/2099-03-01": { start: "14:00", end: "16:00" },
  "teams/full/schedule/2099-03-01": { opp: "Thuisclub B", home: true }, "teams/full/matches/2099-03-01": { start: "15:00" } };
await plans("club-calendar", null, "/club.html#cal", async page => {
  await page.waitForTimeout(800);
  const r = [], clash = await page.evaluate(`[...document.querySelectorAll(".cal-m.clash .warn")].map(x => x.textContent)`);
  if (clash.length !== 2) r.push("expected the two home matches on 1 March 2099 to clash, got: " + JSON.stringify(clash));
  if (!/Hockey Heren/.test(clash.join())) r.push("the clash doesn't name the other team");
  return r;
}, CLUB_DB);
await plans("club-announcement", null, "/club.html#news", async page => {
  page.on("dialog", d => d.accept());
  await page.fill("#club-news textarea", "Clubhuis dicht zondag");
  await page.click("#club-news button.primary");
  await page.waitForTimeout(1000);
  const all = await fetch(`${BASE}/clubNews/khc.json`).then(x => x.json()), item = Object.values(all || {})[0] || {};
  const r = [];
  if (item.text !== "Clubhuis dicht zondag" || item.by !== USER.uid || !/^\d{4}-\d{2}-\d{2}$/.test(item.until || "")) r.push("announcement not saved right: " + JSON.stringify(all));
  if (!/wordt verstuurd/.test(await page.evaluate(`document.getElementById("club-body").innerText`))) r.push("no 'being sent' line");
  return r;
}, CLUB_DB);
await plans("pilot", { plan: "pro", until: "2099-12-31", src: "pilot" }, "/admin.html?t=golf#sec-plan", async page => {
  const r = [], text = await page.evaluate(`document.getElementById("plan-body").innerText`);
  if (!/Pilootploeg/.test(text)) r.push("the subscription doesn't say pilot: " + text.slice(0, 80));
  if (!/19,50/.test(text)) r.push("no pilot price on the upgrade button: " + text.slice(0, 120));
  await page.goto(BASE + "/?t=golf#ranking", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.evaluate(shown("#view-rank .pro-lock"))) r.push("a pilot team's ranking is locked");
  return r;
});

// ---- the RostiQ admin page (for the RostiQ admin only): the numbers ----
if (!only || "rostiq-numbers".includes(only)) {
  await put();
  const day = 864e5, now = Date.now();
  await fetch(`${BASE}/.json`, { method: "PATCH", body: JSON.stringify({
    "teams/fresh/meta": { createdBy: USER.uid, createdAt: now - 2 * day }, "teams/golf/meta": { createdBy: USER.uid, createdAt: now - 20 * day },
    "billing/fresh": { trial: now + 20 * day }, "billing/full": { plan: "pro", until: "2099-06-30", src: "paid",
      history: { tr_a: { at: now - day, cents: 3900, plan: "pro", until: "2099-06-30", mode: "live" }, tr_t: { at: now - day, cents: 3900, plan: "pro", until: "2099-06-30", mode: "test" } } },
    [`lastSeen/full/${USER.uid}`]: now - day }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-BE", serviceWorkers: "block" });
  await context.addInitScript(() => { try { localStorage.setItem("fakeUser", JSON.stringify({ uid: "u-pa", email: "levicaers1@gmail.com", displayName: "Levi" }));
    localStorage.setItem("lang", "nl"); localStorage.setItem("pushLater", String(Date.now())); } catch {} });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push("script error: " + e.message));
  try {
    await page.goto(BASE + "/rostiq.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#teams .swatch", { timeout: 10000 }); // the teams (and with them the numbers) are loaded
    const text = await page.evaluate(`document.getElementById("numbers").innerText`);
    for (const want of ["Ploegen", "Betalende ploegen", "Proef", "deze week", "grootste ploeg"]) if (!text.includes(want)) errors.push("numbers lack " + want);
    if (!/€\s?39(?!\d)/.test(text)) errors.push("the live payment isn't counted");
    if (/€\s?78(?!\d)/.test(text)) errors.push("a test payment was counted as money");
    if ((await page.$$("#numbers .wk")).length !== 8) errors.push("not 8 weeks in the chart");
    await page.locator("#numbers").screenshot({ path: path.join(OUT, "rostiq-numbers.png") });
  } catch (e) { errors.push("could not test: " + e.message.split("\n")[0]); }
  checked++;
  if (errors.length) failures.push({ where: "rostiq numbers", errors });
  console.log(`${errors.length ? "✗" : "✓"} rostiq       numbers${errors.length ? "\n    " + errors.join("\n    ") : ""}`);
  await context.close();
}

await browser.close();
server.kill();
console.log(`\n${checked - failures.length}/${checked} page checks passed. Screenshots: tests/out/`);
process.exit(failures.length ? 1 : 0);
