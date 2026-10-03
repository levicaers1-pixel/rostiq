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

function syncSession() {
  if (AUTH_ON) {
    const uid = session.user && session.user.uid;
    const pid = uid && root.users && root.users[uid] && root.users[uid].pid;
    session.pid = pid && root.players && root.players[pid] ? pid : null;
    session.ready = true;
  }
  renderAuth();
  render();
}

// Kick off: with login, wait for the user; otherwise connect straight away.
function start() {
  applyStaticTexts();
  injectAuthUI();
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
