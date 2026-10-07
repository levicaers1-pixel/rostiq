// Shared by index.html and carpool.html: schedule, database connection and helpers.
// Each page defines a global render() that is called whenever the data changes.

const EVENTS = [
  { date: "2026-11-14", opp: "Mormal" },
  { date: "2026-11-21", opp: "Hainaut" },
  { date: "2026-12-13", opp: "Lille Métropole" },
  { date: "2026-12-19", opp: "Hainaut" },
  { date: "2027-01-17", opp: "Kapellen" },
  { date: "2027-01-23", opp: "Hainaut" },
  { date: "2027-02-13", opp: "Lille Métropole" },
  { date: "2027-02-21", opp: "Mormal" },
  { date: "2027-02-27", opp: "Hainaut" },
  { date: "2027-03-06", opp: "Keerbergen" },
  { date: "2027-03-13", opp: "Rigenée", final: true },
];
const TEAM_SIZE = 15;

const DB = (window.FIREBASE_DB_URL || "").trim().replace(/\/+$/, "");

const TODAY = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
const isPast = e => e.date < TODAY;

const parse = d => new Date(d + "T12:00:00");
const fmt = (d, opts) => parse(d).toLocaleDateString(LOCALE, opts);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Per-viewer UI preferences (not shared).
const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---- Match details (time, venue, meeting point), set by the admin ----
// Stored at matches/{date}: { start, end, venue: { name, address, lat, lon }, meet, info }.
const matchInfo = e => (root.matches && root.matches[e.date]) || {};
const timeText = e => {
  const m = matchInfo(e);
  return m.start ? m.start + (m.end ? "–" + m.end : "") : "";
};
const venueText = v => (v ? [v.name, v.address].filter(Boolean).join(", ") : "");
const mapsUrl = v => "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(venueText(v) || (v.lat != null ? `${v.lat},${v.lon}` : ""));

function kmBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---- Weather forecast at the venue (Open-Meteo, free, no key), from ~2 weeks before the match ----
const WX_ICON = c => c === 0 ? "☀️" : c <= 2 ? "🌤️" : c === 3 ? "☁️" : c <= 48 ? "🌫️" : c <= 57 ? "🌦️"
  : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌦️" : c <= 86 ? "🌨️" : "⛈️";
const wxCache = {};
function weatherFor(e) {
  const v = matchInfo(e).venue;
  if (!v || v.lat == null) return null;
  const days = Math.round((parse(e.date) - parse(TODAY)) / 864e5);
  if (days < 0 || days > 15) return null; // forecasts only reach ~16 days ahead
  const key = `wx:${e.date}:${v.lat.toFixed(2)},${v.lon.toFixed(2)}`;
  if (key in wxCache) return wxCache[key];
  try {
    const c = JSON.parse(pref.get(key, "null"));
    if (c && Date.now() - c.at < 3 * 3600e3) return (wxCache[key] = c.wx); // refresh every 3 hours
  } catch {}
  wxCache[key] = null; // fetching (or unavailable)
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max" +
    `&timezone=Europe%2FBrussels&start_date=${e.date}&end_date=${e.date}`;
  fetch(url).then(r => r.json()).then(j => {
    const d = j.daily;
    if (!d || !d.time || !d.time.length || d.temperature_2m_max[0] == null) return;
    const wx = { code: d.weather_code[0], max: Math.round(d.temperature_2m_max[0]), min: Math.round(d.temperature_2m_min[0]),
      rain: d.precipitation_probability_max[0], wind: Math.round(d.wind_speed_10m_max[0]) };
    wxCache[key] = wx;
    pref.set(key, JSON.stringify({ at: Date.now(), wx }));
    render();
  }).catch(() => {});
  return null;
}
const wxText = wx => `${WX_ICON(wx.code)} ${wx.max}°/${wx.min}° · 💨 ${wx.wind} ${t("unit.kmh")}` +
  (wx.rain != null ? ` · 💧 ${wx.rain}%` : "");

// Venue name + town only (last part of the address), for compact lists.
const venueShort = v => (v ? [v.name, (v.address || "").split(", ").pop()].filter(Boolean).join(", ") : "");

// One or two lines with time, venue (+ Maps link), meeting point and info.
// extra = HTML after the venue; compact = venue name + town instead of the full address.
function detailsHtml(e, extra = "", compact = false) {
  const m = matchInfo(e), v = m.venue;
  const bits = [];
  const time = timeText(e) && `🕘 ${esc(timeText(e))}`;
  const place = v && `📍 ${esc(compact ? venueShort(v) : venueText(v))} <a href="${mapsUrl(v)}" target="_blank" rel="noopener">${t("maps")} ↗</a>${extra}`;
  // Compact lists put time and place on their own lines; elsewhere they share one line.
  if (compact) [time, place].filter(Boolean).forEach(x => bits.push(`<div>${x}</div>`));
  else if (time || place) bits.push(`<div>${[time, place].filter(Boolean).join(" · ")}</div>`);
  const wx = weatherFor(e);
  if (wx) bits.push(`<div title="${t("weather.title")}">${wxText(wx)}</div>`);
  if (m.meet) bits.push(`<div>🚩 ${t("meet")}: ${esc(m.meet)}</div>`);
  if (m.info) bits.push(`<div>ℹ️ ${esc(m.info)}</div>`);
  return bits.length ? `<div class="details">${bits.join("")}</div>` : "";
}

// ---- Shared state (mirror of the database root) ----
let root = {};

function defaultPlayers() {
  const players = {};
  for (let i = 1; i <= TEAM_SIZE; i++) players["p" + String(i).padStart(2, "0")] = { order: i };
  return players;
}

// Apply a Firebase "put" or "patch" at a path to the local mirror.
// Patch keys may themselves be paths (e.g. "players/p01").
function apply(path, value, merge) {
  if (merge) {
    for (const k in value) apply(`${path}/${k}`, value[k], false);
    return;
  }
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) { root = value || {}; return; }
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last]; else node[last] = value;
}

// ---- Login (Firebase Authentication) ----
// Login is switched on by putting FIREBASE_CONFIG in config.js. Without it the
// page works as before: no accounts, everyone can edit everything.
const ADMIN_EMAIL = "levicaers1@gmail.com";
const AUTH_ON = !!window.FIREBASE_CONFIG;
const SDK = "https://www.gstatic.com/firebasejs/12.12.0/";
// user: Firebase user; pid: the player row this account has claimed.
const session = { user: null, admin: !AUTH_ON, pid: null, ready: !AUTH_ON };
let fbAuth = null, A = null;

// Only the admin and a row's own player may change it (the database rules enforce the same).
const canEdit = pid => session.admin || (!!pid && pid === session.pid);

async function dbUrl(path, forceRefresh) {
  const t = AUTH_ON && session.user ? await session.user.getIdToken(forceRefresh) : null;
  return `${DB}/${path}.json` + (t ? `?auth=${encodeURIComponent(t)}` : "");
}

async function send(method, path, value) {
  if (!DB) return;
  try {
    const res = await fetch(await dbUrl(path), {
      method,
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    if (!res.ok) throw new Error(res.status);
  } catch (e) {
    setStatus("err", t(AUTH_ON ? "status.notSavedOwnRow" : "status.saveFailed"));
  }
}

async function write(path, value) {
  apply(path, value, false);
  render();
  return send(value === null ? "DELETE" : "PUT", path, value === null ? undefined : value);
}

// Several paths in one atomic update, e.g. { "players/p01/uid": "...", "users/abc/pid": "p01" }.
async function update(changes) {
  for (const [path, value] of Object.entries(changes)) apply(path, value, false);
  render();
  return send("PATCH", "", changes);
}

function setStatus(cls, text) {
  const el = document.getElementById("status");
  el.className = "status " + cls;
  el.textContent = text;
}

let es = null;
async function connect(forceRefresh) {
  if (!DB) {
    root = { players: defaultPlayers() };
    document.getElementById("banner").hidden = false;
    setStatus("err", t("status.notConnected"));
    render();
    return;
  }
  if (es) es.close();
  let seeded = false;
  const stream = es = new EventSource(await dbUrl("", forceRefresh));
  const onEvent = merge => e => {
    if (stream !== es) return;
    const { path, data } = JSON.parse(e.data);
    apply(path, data, merge);
    if (!seeded && path === "/" && !merge) {
      seeded = true;
      if (!root.initialized && session.admin) {
        // First visit ever: create the 15 default rows. Rules only allow writes
        // per player, so use multi-path keys ("players/p01") rather than a nested object.
        const changes = { initialized: true };
        for (const [id, p] of Object.entries(defaultPlayers())) changes[`players/${id}`] = p;
        update(changes);
      }
    }
    setStatus("live", t("status.live"));
    syncSession();
  };
  stream.addEventListener("put", onEvent(false));
  stream.addEventListener("patch", onEvent(true));
  stream.addEventListener("cancel", () => setStatus("err", t("status.denied")));
  // Login tokens expire after an hour; reconnect with a fresh one.
  stream.addEventListener("auth_revoked", () => { if (stream === es) connect(true); });
  stream.onopen = () => setStatus("live", t("status.live"));
  stream.onerror = () => setStatus("err", t("status.reconnecting"));
}

function disconnect() {
  if (es) es.close();
  es = null;
  root = {};
}

// The group invite link lives in the database (not in this public repo), so only signed-in teammates see it.
const WA_LINK = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
function renderWaGroup() {
  const a = document.getElementById("wa-group");
  const link = root.settings && root.settings.waGroup;
  a.hidden = !(link && WA_LINK.test(link));
  if (!a.hidden) a.href = link;
}

// ---- Phone numbers: stored as digits with country code (e.g. 32470123456), used for wa.me chats ----
function normPhone(raw) {
  let s = String(raw || "").trim();
  const plus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  if (!plus) {
    if (s.startsWith("00")) s = s.slice(2);
    else if (s.startsWith("0")) s = "32" + s.slice(1); // local number: assume Belgium
  }
  return /^[1-9][0-9]{7,14}$/.test(s) ? s : null;
}
const phoneOf = pid => (root.players && root.players[pid] && root.players[pid].phone) || "";
const firstName = name => String(name || "").trim().split(/\s+/)[0];
const waChat = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
const shortDate = d => fmt(d, { weekday: "short", day: "numeric", month: "numeric" });

// Ask the signed-in player for their number once (until they fill it in or tap "Later").
function renderPhonePrompt() {
  const box = document.getElementById("phone-prompt");
  const pid = session.pid;
  box.hidden = !(AUTH_ON && pid && !phoneOf(pid) && pref.get("phoneLater", "") !== pid);
}
function injectPhonePrompt() {
  document.querySelector("main .sub").insertAdjacentHTML("afterend", `
    <form class="phone-prompt" id="phone-prompt" hidden>
      <p>${t("phone.prompt")}</p>
      <div class="phone-row">
        <input type="tel" name="phone" placeholder="${t("phone.ph")}" autocomplete="tel" inputmode="tel">
        <button type="submit">${t("phone.save")}</button>
        <button type="button" class="link" data-later>${t("phone.later")}</button>
      </div>
      <p class="err" hidden>${t("phone.invalid")}</p>
    </form>`);
  const form = document.getElementById("phone-prompt");
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const n = normPhone(form.phone.value);
    form.querySelector(".err").hidden = !!n;
    if (n && session.pid) write(`players/${session.pid}/phone`, n);
  });
  form.querySelector("[data-later]").onclick = () => { pref.set("phoneLater", session.pid || ""); renderPhonePrompt(); };
}

function syncSession() {
  if (AUTH_ON) {
    const uid = session.user && session.user.uid;
    const pid = uid && root.users && root.users[uid] && root.users[uid].pid;
    session.pid = pid && root.players && root.players[pid] ? pid : null;
    session.ready = true;
  }
  renderWaGroup();
  renderPhonePrompt();
  renderAuth();
  render();
}

// ---- Countdown to the next match, above the page title ----
function injectCountdown() {
  const next = EVENTS.find(e => !isPast(e));
  if (!next) return;
  const n = Math.round((parse(next.date) - parse(TODAY)) / 864e5);
  const opp = next.opp + (next.final ? " 🏆" : "");
  const text = n === 0 ? t("countdown.today", { opp }) : n === 1 ? t("countdown.tomorrow", { opp }) : t("countdown.days", { n, opp });
  document.querySelector("main h1").insertAdjacentHTML("beforebegin",
    `<div class="countdown${n <= 1 ? " soon" : ""}">${esc(text)} <span>· ${esc(fmt(next.date, { weekday: "short", day: "numeric", month: "short" }))}</span></div>`);
}

// ---- Share window: an editable message to send to the team group (both pages) ----
// WhatsApp has no link that posts straight into a group, so the quickest routes are:
//  - "Copy & open group": copies the text and opens the team group (invite link) – just paste;
//  - "Share…": the phone's own share sheet, where the group shows among recent chats.
function injectShareDialog() {
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="share" class="share-dlg">
      <h3 id="share-title"></h3>
      <textarea id="share-text" rows="14"></textarea>
      <p class="hint" id="share-hint"></p>
      <div class="people" id="share-people"></div>
      <div class="row">
        <button id="share-close">${t("close")}</button>
        <button id="share-copy">${t("copy")}</button>
        <button id="share-native" class="primary-wa">${t("share.native")}</button>
        <a class="btn" id="share-group" target="_blank" rel="noopener">${t("share.copyOpen")}</a>
      </div>
    </dialog>`);
  const dlg = document.getElementById("share"), ta = document.getElementById("share-text");
  const copy = () => {
    // Started synchronously inside the tap, so phones allow it before the group link opens.
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
    else { ta.select(); document.execCommand("copy"); }
  };
  document.getElementById("share-close").onclick = () => dlg.close();
  document.getElementById("share-copy").onclick = ev => { copy(); ev.target.textContent = t("copied"); };
  document.getElementById("share-group").addEventListener("click", copy); // the link itself opens the group
  document.getElementById("share-native").onclick = () =>
    navigator.share({ text: ta.value }).catch(() => {}); // cancelled: nothing to do
  window.openShare = (title, text, people = []) => {
    document.getElementById("share-people").innerHTML = people.length ? `<p class="hint">${t("remind.personal")}</p>` +
      people.map(p => p.phone
        ? `<a class="dm" href="${waChat(p.phone, p.text)}" target="_blank" rel="noopener">💬 ${esc(p.name)}</a>`
        : `<span class="dm off">${esc(p.name)} <small>(${t("remind.noPhone")})</small></span>`).join("") : "";
    const group = root.settings && root.settings.waGroup;
    const canShare = !!navigator.share && matchMedia("(pointer: coarse)").matches;
    const groupBtn = document.getElementById("share-group");
    groupBtn.hidden = !group;
    if (group) groupBtn.href = group;
    document.getElementById("share-native").hidden = !canShare;
    document.getElementById("share-hint").textContent =
      t(group ? "share.hintGroup" : canShare ? "share.hintNative" : "share.hintCopy");
    document.getElementById("share-title").textContent = title;
    document.getElementById("share-copy").textContent = t("copy");
    ta.value = text;
    dlg.showModal();
  };
}
// Join message lines. Optional lines that are empty/false/0 are dropped; BLANK gives an intentional empty line.
const BLANK = {};
// Short, readable Maps link for chat messages ("…?q=Golf+de+Mormal,+59144+Preux-au-Sart").
const chatMapsUrl = v => "https://maps.google.com/?q=" +
  encodeURIComponent(venueShort(v) || `${v.lat},${v.lon}`).replace(/%20/g, "+").replace(/%2C/g, ",");
const lines = arr => arr.filter(l => l === BLANK || (typeof l === "string" && l))
  .map(l => (l === BLANK ? "" : l)).join("\n");
const pageUrl = file => location.href.split(/[?#]/)[0].replace(/[^/]*$/, file);

// Kick off: with login, wait for the user; otherwise connect straight away.
function start() {
  applyStaticTexts();
  injectAuthUI();
  injectCountdown();
  injectPhonePrompt();
  document.body.insertAdjacentHTML("beforeend", `<footer class="site-footer">${t("footer")}</footer>`);
  injectShareDialog();
  if (AUTH_ON) initAuth(); else connect();
}

async function initAuth() {
  try {
    const [appMod, authMod] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]);
    A = authMod;
    fbAuth = A.getAuth(appMod.initializeApp(window.FIREBASE_CONFIG));
  } catch (e) {
    gateMessage(t("auth.loadFailed"), true);
    return;
  }
  // Coming back from the link in a sign-in email.
  if (A.isSignInWithEmailLink(fbAuth, location.href)) {
    let email = pref.get("signinEmail", "");
    if (!email) email = prompt(t("auth.emailPrompt")) || "";
    try {
      if (email) await A.signInWithEmailLink(fbAuth, email.trim(), location.href);
    } catch (e) {
      gateMessage(t("auth.linkExpired"), true);
    }
    history.replaceState(null, "", location.pathname);
  }
  // Coming back from a Google redirect: success arrives via onAuthStateChanged; surface failures.
  A.getRedirectResult(fbAuth).catch(() =>
    gateMessage(t("auth.redirectFailed"), true));
  A.onAuthStateChanged(fbAuth, user => {
    session.user = user;
    session.admin = !!user && user.emailVerified && (user.email || "").toLowerCase() === ADMIN_EMAIL;
    session.pid = null;
    session.ready = !user; // with a user, wait for the data before deciding on the claim screen
    if (user) connect(); else disconnect();
    renderAuth();
    render();
  });
}

// ---- Login UI (shared by both pages) ----
function injectAuthUI() {
  const brand = document.querySelector(".brand-inner");
  brand.insertAdjacentHTML("beforeend", `<div class="corner">
    <div class="account" id="account" hidden></div>
    <div class="lang" role="group" aria-label="Language">
      <button data-lang="nl" aria-pressed="${LANG === "nl"}">NL</button><button data-lang="en" aria-pressed="${LANG === "en"}">EN</button>
    </div></div>`);
  brand.querySelector(".lang").addEventListener("click", ev => {
    const b = ev.target.closest("[data-lang]");
    if (!b || b.dataset.lang === LANG) return;
    pref.set("lang", b.dataset.lang);
    location.reload();
  });
  document.querySelector("main").insertAdjacentHTML("beforebegin", `<section class="gate" id="gate" hidden></section>`);
  document.querySelector("main .sub").insertAdjacentHTML("afterend",
    `<a class="wa-group" id="wa-group" hidden target="_blank" rel="noopener" title="${t("wa.title")}">${t("wa.open")}</a>`);
  document.getElementById("account").addEventListener("click", ev => {
    if (ev.target.closest("[data-signout]")) A.signOut(fbAuth);
  });
  document.getElementById("gate").addEventListener("click", onGateClick);
  document.getElementById("gate").addEventListener("submit", onGateSubmit);
}

// Running as an app from the home screen (it keeps its own login, separate from the browser).
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

let gateMsg = { text: "", err: false };
function gateMessage(text, err) { gateMsg = { text, err }; renderAuth(); }

function renderAuth() {
  if (!AUTH_ON) return;
  const gate = document.getElementById("gate"), main = document.querySelector("main"), acct = document.getElementById("account");
  const u = session.user;
  const needClaim = u && session.ready && !session.pid && !session.admin;
  const showGate = !u || needClaim;
  gate.hidden = !showGate;
  main.hidden = showGate || (u && !session.ready);

  acct.hidden = !u;
  if (u) {
    const who = session.pid ? esc(root.players[session.pid].name || "") : esc(u.email || "");
    acct.innerHTML = `<span>${who}${session.admin ? ' <span class="admin-tag">admin</span>' : ""}</span>
      <button data-signout class="link">${t("auth.signOut")}</button>`;
  }

  const msg = gateMsg.text ? `<p class="gate-msg ${gateMsg.err ? "err" : ""}">${esc(gateMsg.text)}</p>` : "";
  if (!u) {
    gate.innerHTML = `<div class="gate-card">
      <h1>${t("auth.signIn")}</h1>
      <p class="sub">${t("auth.signInSub")}</p>
      <button class="google" data-google>
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        ${t("auth.google")}</button>
      <div class="or">${t("auth.orEmail")}</div>
      <form class="email-form">
        <input type="email" name="email" required placeholder="you@example.com" autocomplete="email" value="${esc(pref.get("signinEmail", ""))}">
        <button type="submit">${t("auth.sendLink")}</button>
      </form>
      ${msg}
      <p class="hint">${t(standalone() ? "auth.hintApp" : "auth.hintBrowser")}</p>
    </div>`;
  } else if (needClaim) {
    const free = sortedPlayers().filter(p => p.name && !p.uid);
    gate.innerHTML = `<div class="gate-card">
      <h1>${t("auth.whichPlayer")}</h1>
      <p class="sub">${t("auth.claimSub", { email: esc(u.email || "") })}</p>
      <div class="claim-list">${free.length
        ? free.map(p => `<button data-claim="${p.id}">${esc(p.name)}</button>`).join("")
        : `<p class="hint">${t("auth.noFree")}</p>`}</div>
      ${msg}
      <p class="hint">${t("auth.claimHelp")} <button class="link" data-signout-gate>${t("auth.signOut")}</button></p>
    </div>`;
  }
}

async function onGateClick(ev) {
  if (ev.target.closest("[data-google]")) {
    try {
      // Phones handle a full-page redirect better than a popup tab; the home-screen
      // app and desktops keep the popup so the page itself isn't navigated away.
      const phoneBrowser = matchMedia("(pointer: coarse)").matches && !standalone();
      if (phoneBrowser) return await A.signInWithRedirect(fbAuth, new A.GoogleAuthProvider());
      await A.signInWithPopup(fbAuth, new A.GoogleAuthProvider());
      gateMsg = { text: "", err: false };
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request")
        gateMessage(t("auth.googleFailed"), true);
    }
  }
  const c = ev.target.closest("[data-claim]");
  if (c) {
    const pid = c.dataset.claim, uid = session.user.uid;
    gateMsg = { text: "", err: false };
    await update({ [`players/${pid}/uid`]: uid, [`users/${uid}/pid`]: pid });
    syncSession();
  }
  if (ev.target.closest("[data-signout-gate]")) A.signOut(fbAuth);
}

async function onGateSubmit(ev) {
  ev.preventDefault();
  const email = ev.target.email.value.trim();
  try {
    await A.sendSignInLinkToEmail(fbAuth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
    pref.set("signinEmail", email);
    gateMessage(t("auth.checkEmail", { email }), false);
  } catch (e) {
    gateMessage(t(e.code === "auth/quota-exceeded" ? "auth.quota" : "auth.sendFailed"), true);
  }
}

function sortedPlayers() {
  const players = root.players || {};
  return Object.keys(players)
    .map(id => ({ id, ...players[id], avail: players[id].avail || {} }))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
}

const displayName = (p, i) => p.name || t("playerN", { n: i + 1 });

const slug = t => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
