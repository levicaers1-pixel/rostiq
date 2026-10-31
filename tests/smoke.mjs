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
await browser.close();
server.kill();
console.log(`\n${checked - failures.length}/${checked} page checks passed. Screenshots: tests/out/`);
process.exit(failures.length ? 1 : 0);
