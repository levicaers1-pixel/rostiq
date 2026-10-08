// RostiQ – shared by all pages: teams, database connection, login and helpers.
// Each page defines a global render() that is called whenever the data changes.
// Everything of one team lives under teams/{TEAM_ID}/ in the database; `root` mirrors that subtree.

const DB = (window.FIREBASE_DB_URL || "").trim().replace(/\/+$/, "");

// Per-viewer UI preferences (not shared).
const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---- Which team: ?t=<id> in the address, else the last team used on this device ----
const QUERY = new URLSearchParams(location.search);
const WANT_PICKER = QUERY.has("pick");
let TEAM_ID = WANT_PICKER ? "" : (QUERY.get("t") || pref.get("team", "") || "").toLowerCase();
const NO_TEAM_PAGE = !!window.PLATFORM_PAGE; // the RostiQ admin page works across teams

// True while the team's name/logo aren't known yet on this device: the header stays empty instead of showing "RostiQ".
let brandUnknown = false;
let teamInfoKnown = false; // the team's name/logo are known (from the database or remembered on this device)
function mergeTeamInfo(info) {
  if (info) { brandUnknown = false; teamInfoKnown = true; }
  for (const k of Object.keys(TEAM)) if (k !== "id") delete TEAM[k];
  Object.assign(TEAM, TEAM_DEFAULTS, info || {}, { id: TEAM_ID });
  // Remember the branding on this device, so the next page shows it before the data arrives (boot.js).
  if (info && TEAM_ID && !NO_TEAM_PAGE) {
    const { events, ...brand } = info, v = JSON.stringify(brand);
    if (pref.get("brand:" + TEAM_ID) !== v) pref.set("brand:" + TEAM_ID, v);
  }
}
// The branding remembered from an earlier visit (or null).
function cachedTeamInfo() {
  if (!TEAM_ID || NO_TEAM_PAGE) return null;
  try { return JSON.parse(pref.get("brand:" + TEAM_ID, "null")); } catch { return null; }
}

// Schedule: the team's list in the database (schedule/{date}); TEAM.events only as a fallback.
let EVENTS = [];
function refreshEvents() {
  const s = root.schedule || {};
  const fromDb = (root.settings && root.settings.scheduleInDb) || Object.keys(s).length;
  EVENTS = fromDb
    ? Object.keys(s).sort().map(date => ({ date, opp: s[date].opp || "?", ...(s[date].final ? { final: true } : {}) }))
    : (TEAM.events || []).slice();
}
const seasonName = () => (root.settings && root.settings.seasonName) || TEAM.season || TEAM.brand;
const teamSize = () => TEAM.teamSize ?? 0;

const TODAY = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
const isPast = e => e.date < TODAY;

const parse = d => new Date(d + "T12:00:00");
const fmt = (d, opts) => parse(d).toLocaleDateString(LOCALE, opts);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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

// ---- Shared state (mirror of teams/{TEAM_ID}) ----
let root = {};
let dataLoaded = false; // the team's data has arrived (until then pages show skeleton placeholders)
const skeletonCards = n => Array.from({ length: n }, () => `<div class="skel-card" aria-hidden="true">
  <div class="skel skel-block"></div><div class="skel-lines"><div class="skel" style="width:55%"></div><div class="skel" style="width:35%"></div>
  <div class="skel" style="width:90%;height:8px;margin-top:14px"></div><div class="skel" style="width:40%"></div></div></div>`).join("");

function defaultPlayers() {
  const players = {};
  for (let i = 1; i <= teamSize(); i++) players["p" + String(i).padStart(2, "0")] = { order: i };
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

// ---- Login (Firebase Authentication) and roles ----
// platformAdmin: RostiQ owner (all teams). admin: manages this team (team admin or platform admin).
// pid: this account's player row in the team. pending: signed in, waiting for the team admin.
const PLATFORM = (window.PLATFORM_ADMINS || []).map(e => e.toLowerCase());
const AUTH_ON = !!window.FIREBASE_CONFIG;
const SDK = "https://www.gstatic.com/firebasejs/12.12.0/";
const session = { user: null, platformAdmin: !AUTH_ON, admin: !AUTH_ON, pid: null, ready: !AUTH_ON,
  pending: false, request: null, picking: false, teams: null, noTeam: false };
let fbAuth = null, A = null;

// Only the admin and a row's own player may change it (the database rules enforce the same).
const canEdit = pid => session.admin || (!!pid && pid === session.pid);

async function token(forceRefresh) {
  return AUTH_ON && session.user ? session.user.getIdToken(forceRefresh) : null;
}
// Absolute database path (e.g. "users/<uid>/teams") …
async function dbUrlAbs(path, forceRefresh) {
  const tk = await token(forceRefresh);
  return `${DB}/${path}.json` + (tk ? `?auth=${encodeURIComponent(tk)}` : "");
}
// … and a path inside the current team (e.g. "players/p01" → teams/<id>/players/p01).
const dbUrl = (path, forceRefresh) => dbUrlAbs(`teams/${TEAM_ID}${path ? "/" + path : ""}`, forceRefresh);
const getAbs = async path => fetch(await dbUrlAbs(path)).then(r => (r.ok ? r.json() : null)).catch(() => null);

async function send(method, path, value, abs) {
  if (!DB) return false;
  try {
    const res = await fetch(await (abs ? dbUrlAbs(path) : dbUrl(path)), {
      method,
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    if (!res.ok) throw new Error(res.status);
    return true;
  } catch (e) {
    setStatus("err", t(AUTH_ON ? "status.notSavedOwnRow" : "status.saveFailed"));
    return false;
  }
}

// Writes inside the current team (applied locally first, so the page reacts immediately).
async function write(path, value) {
  apply(path, value, false);
  refreshEvents();
  render();
  shareProfile({ [path]: value });
  return saved(send(value === null ? "DELETE" : "PUT", path, value === null ? undefined : value));
}
// Several paths in one atomic update, e.g. { "players/p01/uid": "...", "members/<uid>": "p01" }.
async function update(changes) {
  for (const [path, value] of Object.entries(changes)) apply(path, value, false);
  refreshEvents();
  render();
  shareProfile(changes);
  return saved(send("PATCH", "", changes));
}

// ---- Toasts: a short "Saved ✓" after something the user did (not after automatic syncing), errors always ----
const userActed = () => !navigator.userActivation || navigator.userActivation.isActive;
async function saved(pending) {
  const acted = userActed(); // read now: the request takes a moment
  const ok = await pending;
  if (!ok) toast(t("status.saveFailed"), "err");
  else if (acted) toast(t("toast.saved"));
  return ok;
}
let toastTimer = null;
function toast(text, kind = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  el.innerHTML = (kind === "err" ? ic("x") : ic("check")) + `<span>${esc(text)}</span>`;
  el.classList.toggle("err", kind === "err");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), kind === "err" ? 4000 : 1600);
}
// Outside the current team (e.g. the "my teams" index users/<uid>/teams/<id>).
const writeAbs = (path, value) => send(value === null ? "DELETE" : "PUT", path, value === null ? undefined : value, true);

function setStatus(cls, text) {
  const el = document.getElementById("status");
  if (!el) return;
  el.className = "status " + cls;
  el.textContent = text;
}

let es = null;
async function connect(forceRefresh) {
  if (!DB) {
    root = { players: defaultPlayers() };
    dataLoaded = true;
    document.getElementById("banner").hidden = false;
    setStatus("err", t("status.notConnected"));
    syncSession();
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
      dataLoaded = true;
      if (!root.initialized && session.admin) {
        // A team's first visit: create the empty player rows (if the team wants any).
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
  dataLoaded = false;
}

// The group invite link lives in the database, so only signed-in teammates see it.
const WA_LINK = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
function renderWaGroup() {
  const a = document.getElementById("wa-group");
  if (!a) return;
  const link = root.settings && root.settings.waGroup;
  a.hidden = !(link && WA_LINK.test(link));
  if (!a.hidden) a.href = link;
}

// ---- Places (gemeente): OpenStreetMap Nominatim, confirmed from a list so everyone's distances are right ----
const COUNTRY = LANG === "nl" ? { be: "", nl: "Nederland", fr: "Frankrijk", lu: "Luxemburg" } : { be: "", nl: "Netherlands", fr: "France", lu: "Luxembourg" };
function describePlace(r) {
  const a = r.address || {};
  const name = r.name || (r.display_name || "").split(",")[0];
  const town = a.city || a.town || a.village || a.municipality;
  const region = a.county || a.state;
  const extra = [...new Set([town, region].filter(x => x && x !== name))];
  return { name, label: extra.length ? `${name} (${extra.join(", ")})` : name, country: COUNTRY[a.country_code] || "" };
}
async function searchPlaces(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&addressdetails=1" +
    "&countrycodes=be,nl,fr,lu&q=" + encodeURIComponent(q.trim());
  const hits = await fetch(url, { headers: { "Accept-Language": "nl,en" } }).then(r => r.json());
  const seen = new Set();
  return hits
    .filter(r => ["boundary", "place"].includes(r.category))
    .map(r => ({ ...describePlace(r), lat: Number(r.lat), lon: Number(r.lon), be: (r.address || {}).country_code === "be" }))
    .filter(r => !seen.has(r.label) && seen.add(r.label))
    .sort((a, b) => b.be - a.be)
    .slice(0, 6);
}
const setPlace = (pid, r) => update({
  [`players/${pid}/gemeente`]: r.name.slice(0, 60),
  [`players/${pid}/geo`]: { lat: r.lat, lon: r.lon, label: r.label.slice(0, 120) },
});

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
  if (window.WELCOME_HANDLES_PHONE && !pref.get(`welcomeHidden:${TEAM_ID}`, "")) { const f = document.getElementById("phone-prompt"); if (f) f.hidden = true; return; }
  const box = document.getElementById("phone-prompt");
  if (!box) return;
  const pid = session.pid;
  box.hidden = !(AUTH_ON && pid && !phoneOf(pid) && pref.get("phoneLater:" + TEAM_ID, "") !== pid);
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
  form.querySelector("[data-later]").onclick = () => { pref.set("phoneLater:" + TEAM_ID, session.pid || ""); renderPhonePrompt(); };
}

// A linked player without a contact email gets the email they sign in with (once per visit).
let loginEmailFilled = false;
function fillLoginEmail() {
  const pid = session.pid, email = session.user && session.user.email;
  if (!AUTH_ON || loginEmailFilled || !pid || !email || !root.players || !root.players[pid] || !profile.data) return;
  loginEmailFilled = true;
  if (!root.players[pid].email && !profile.data.email) write(`players/${pid}/email`, email.toLowerCase());
}

// ---- My personal details, the same in all my teams ----
// users/{uid}/profile holds phone, email, federation number and home town once per account; every team
// keeps a copy in my player row. Changing them in one team updates the profile and my other teams; opening
// a team (or getting approved) copies the profile into that team's row.
const PROFILE_FIELDS = ["phone", "email", "fed", "gemeente", "geo"];
const profile = { data: null, teams: {}, pending: null, applied: false };
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function loadProfile(myTeams) {
  const uid = session.user.uid;
  profile.teams = myTeams || {};
  const teams = Object.entries(profile.teams);
  const [stored, ...rows] = await Promise.all([getAbs(`users/${uid}/profile`),
    ...teams.map(([tid, pid]) => getAbs(`teams/${tid}/players/${pid}`))]);
  const data = stored || {};
  // My own edits always update the profile and all my teams together. So a team row that differs from the
  // profile was changed by a team admin since then: that's the newer value. Fields the profile doesn't
  // have yet also come from my teams (the first team with a value wins).
  const add = {};
  const linked = rows.filter(r => r && r.uid === uid);
  for (const f of PROFILE_FIELDS) {
    const row = linked.find(r => r[f] != null && r[f] !== "" && !sameValue(r[f], data[f]));
    if (row) add[f] = row[f];
  }
  // Use them right away, also if saving the profile fails (it's retried on the next sign-in).
  if (Object.keys(add).length) { Object.assign(data, add); send("PATCH", `users/${uid}/profile`, add, true); }
  if (session.user && session.user.uid !== uid) return; // signed out meanwhile
  // Bring all my other teams in line now (this team is done by applyProfile, which also updates the page).
  teams.forEach(([tid, pid], i) => {
    const row = rows[i];
    if (tid === TEAM_ID || !row || row.uid !== uid) return;
    const fix = Object.fromEntries(PROFILE_FIELDS.filter(f => data[f] != null && !sameValue(row[f], data[f])).map(f => [f, data[f]]));
    if (Object.keys(fix).length) send("PATCH", `teams/${tid}/players/${pid}`, fix, true);
  });
  profile.data = data;
  if (profile.pending) { const p = profile.pending; profile.pending = null; shareProfile(p); } // edits made while loading
  applyProfile();
  fillLoginEmail();
}

// My own personal fields in `changes` (paths like "players/<my pid>/phone") → profile + my other teams.
function shareProfile(changes) {
  if (!AUTH_ON || !session.user || !session.pid) return;
  const base = `players/${session.pid}/`, mine = {};
  for (const [path, value] of Object.entries(changes)) {
    const f = path.startsWith(base) ? path.slice(base.length) : null;
    if (PROFILE_FIELDS.includes(f)) mine[path] = value;
  }
  if (!Object.keys(mine).length) return;
  if (!profile.data) { profile.pending = { ...profile.pending, ...mine }; return; }
  const fields = Object.fromEntries(Object.entries(mine).map(([path, v]) => [path.slice(base.length), v ?? null]));
  const changed = Object.entries(fields).filter(([f, v]) => !sameValue(profile.data[f], v));
  if (!changed.length) return;
  for (const [f, v] of changed) { if (v === null) delete profile.data[f]; else profile.data[f] = v; }
  const uid = session.user.uid, upd = Object.fromEntries(changed);
  send("PATCH", `users/${uid}/profile`, upd, true);
  // One request per team: a team I left (stale index) can't block the others.
  for (const [tid, pid] of Object.entries(profile.teams)) {
    if (tid === TEAM_ID) continue;
    send("PATCH", `teams/${tid}/players/${pid}`, upd, true);
  }
}

// Opening a team: bring my row up to date with my (just reconciled) profile, once per page.
function applyProfile() {
  if (!AUTH_ON || profile.applied || !profile.data || !session.pid || !root.players || !root.players[session.pid]) return;
  profile.applied = true;
  profile.teams[TEAM_ID] = session.pid; // e.g. just approved in this team
  const row = root.players[session.pid], changes = {}, extra = {};
  for (const f of PROFILE_FIELDS) {
    const path = `players/${session.pid}/${f}`;
    if (profile.data[f] != null) { if (!sameValue(row[f], profile.data[f])) changes[path] = profile.data[f]; }
    else if (row[f] != null && row[f] !== "") extra[path] = row[f]; // only known in this team: share it the other way
  }
  if (Object.keys(changes).length) update(changes);
  if (Object.keys(extra).length) shareProfile(extra);
}

function syncSession() {
  if (root.info) mergeTeamInfo(root.info);
  if (AUTH_ON) {
    const uid = session.user && session.user.uid;
    const pid = uid && root.members && root.members[uid];
    session.pid = pid && root.players && root.players[pid] ? pid : null;
    session.admin = session.platformAdmin || !!(uid && root.admins && root.admins[uid] === true);
    session.ready = true;
  }
  applyBranding();
  applyProfile();
  fillLoginEmail();
  refreshEvents();
  renderCountdown();
  renderSeasonTitle();
  renderWaGroup();
  renderPhonePrompt();
  renderAuth();
  render();
}

// ---- Countdown to the next match, above the page title ----
function injectCountdown() {
  document.querySelector("main h1").insertAdjacentHTML("beforebegin", `<div class="countdown" id="countdown" hidden></div>`);
}
function renderCountdown() {
  const el = document.getElementById("countdown");
  if (!el) return;
  const next = EVENTS.find(e => !isPast(e));
  el.hidden = !next;
  if (!next) return;
  const n = Math.round((parse(next.date) - parse(TODAY)) / 864e5);
  const opp = next.opp + (next.final ? " 🏆" : "");
  const text = n === 0 ? t("countdown.today", { opp }) : n === 1 ? t("countdown.tomorrow", { opp }) : t("countdown.days", { n, opp });
  el.className = "countdown" + (n <= 1 ? " soon" : "");
  el.innerHTML = `${esc(text)} <span>· ${esc(fmt(next.date, { weekday: "short", day: "numeric", month: "short" }))}</span>`;
}
// Page title that follows the season name set on the Admin page.
function renderSeasonTitle() {
  document.querySelectorAll("[data-season]").forEach(el => { el.textContent = seasonName(); });
}

// ---- Share window: an editable message to send to the team group ----
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
// Link to a page of this team (used in messages and calendar files), e.g. ".../carpool.html?t=ic-heren-1".
const pageUrl = file => location.href.split(/[?#]/)[0].replace(/[^/]*$/, file) + (TEAM_ID ? `?t=${TEAM_ID}` : "");

// ---- Team colours: a full light + dark palette from two picks (header colour, highlight colour) ----
const HEX = /^#[0-9a-fA-F]{6}$/;
const BRAND_PRESETS = [ // [key, header, highlight]; the first is the RostiQ default (no overrides stored)
  ["rostiq", "#1e1b4b", "#00d4ff"], ["green", "#1f3a2e", "#cdb994"], ["navy", "#16324f", "#c9a227"], ["burgundy", "#5a1f2b", "#d8c3a5"],
  ["black", "#161616", "#d4af37"], ["royal", "#1e3a8a", "#cbd5e1"], ["red", "#9f1d1d", "#e7d3b0"],
  ["orange", "#9a3412", "#fcd34d"], ["purple", "#3b1f6b", "#c4b5fd"], ["teal", "#0f4c4f", "#9fd3c7"],
];
function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return "#" + [0, 8, 4].map(n => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map(c => (c <= .04 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
function makePalette(main, highlight) {
  const [mh, ms, ml] = hexToHsl(main), [hh, hs, hl] = hexToHsl(highlight);
  const darkHeader = luminance(main) < .18;
  const bg = hsl(hh, Math.min(hs, .45), .93);
  const accent = darkHeader ? hsl(mh, ms, Math.min(ml + .06, .35)) : hsl(mh, ms, .28);
  const dBg = hsl(mh, Math.min(ms, .3), .11), dAccent = hsl(hh, hs, Math.max(hl, .65));
  return {
    main, highlight,
    light: {
      "--brand": main, "--brand-text": darkHeader ? bg : hsl(mh, .3, .12), "--accent": accent, "--on-accent": bg,
      "--pampas": highlight, "--bg": bg, "--surface": hsl(hh, Math.min(hs, .45), .965), "--border": hsl(hh, Math.min(hs, .35), .83),
      "--text": hsl(mh, Math.min(ms, .25), .14), "--muted": hsl(mh, Math.min(ms, .08), .44), "--final": hsl(hh, Math.min(hs, .4), .4),
    },
    dark: {
      "--brand": hsl(mh, Math.min(ms, .35), .08), "--brand-text": hsl(hh, Math.min(hs, .4), .91), "--accent": dAccent, "--on-accent": dBg,
      "--pampas": dAccent, "--bg": dBg, "--surface": hsl(mh, Math.min(ms, .3), .15), "--border": hsl(mh, Math.min(ms, .3), .23),
      "--text": hsl(hh, Math.min(hs, .4), .91), "--muted": hsl(mh, .08, .67), "--final": dAccent,
    },
  };
}

// ---- Team branding: logo (or the team name as text), colours, page links carrying ?t= ----
// Avatar colour that stays the same for a name (match cards, team page).
const AV_COLORS = ["#6c5ce7", "#0891b2", "#16a34a", "#d97706", "#db2777", "#2563eb", "#7c3aed", "#0d9488"];
const avColor = n => AV_COLORS[[...(n || "")].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % AV_COLORS.length];
const ROSTIQ_LOGO = `<img class="logo rostiq-logo" src="assets/rostiq-logo-header.png" alt="RostiQ">`;
// brandPreview: unsaved changes on the Admin page, shown live until saved or cancelled.
let brandPreview = null;
function applyBranding() {
  const B = { ...TEAM, ...(brandPreview || {}) };
  const home = document.querySelector(".brand-inner > a");
  if (home) {
    home.href = pageUrl("");
    home.innerHTML = !TEAM_ID || NO_TEAM_PAGE ? ROSTIQ_LOGO // RostiQ itself: team picker, RostiQ admin page
      : brandUnknown ? `<span class="logo-text">&nbsp;</span>`
      : !teamInfoKnown ? ROSTIQ_LOGO // signed out on a team we know nothing about yet
      : B.logo ? `<img class="logo" src="${esc(B.logo)}" alt="${esc(B.brand)}">`
      : `<span class="logo-text">${esc(B.brand)}</span>`;
  }
  // Classic serif headings (e.g. Pampas) or RostiQ's modern sans.
  document.documentElement.classList.toggle("font-serif", !!TEAM_ID && !NO_TEAM_PAGE && B.font === "serif");
  const tabs = document.querySelector(".tabs");
  if (tabs) tabs.hidden = !TEAM_ID; // no team chosen yet: nothing to navigate to
  document.querySelectorAll(".tabs a").forEach(a => {
    const file = (a.getAttribute("href") || "").split("?")[0];
    a.setAttribute("href", file + (TEAM_ID ? `?t=${TEAM_ID}` : ""));
  });
  // Phones: the same tabs as an app-style bar at the bottom (CSS shows one or the other).
  if (tabs) {
    let bar = document.querySelector(".bottom-nav");
    if (!bar) { bar = document.createElement("nav"); bar.className = "bottom-nav"; document.body.append(bar); }
    bar.innerHTML = tabs.innerHTML;
    bar.hidden = tabs.hidden;
    const home = bar.querySelector('a[data-i18n="tab.availability"]');
    if (home) home.textContent = "🗓️ " + t("matches"); // shorter label under the icon (icons.js turns the emoji into the icon)
    document.body.classList.toggle("has-bottom-nav", !tabs.hidden);
  }
  // Only "--name: #rrggbb" pairs reach the style sheet (the database rules allow nothing else either).
  const c = B.colors, vars = o => Object.entries(o || {}).filter(([k, v]) => /^--[a-z-]{2,20}$/.test(k) && HEX.test(v))
    .map(([k, v]) => `${k}: ${v};`).join(" ");
  let style = document.getElementById("team-colors");
  if (!style) { style = document.createElement("style"); style.id = "team-colors"; document.head.append(style); }
  style.textContent = c ? `:root { ${vars(c.light)} } @media (prefers-color-scheme: dark) { :root { ${vars(c.dark)} } }` : "";
  // Phone status bar / browser bar in the header colour.
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.content = (c && c.light && HEX.test(c.light["--brand"] || "") && c.light["--brand"]) || BRAND_PRESETS[0][1];
  const title = document.querySelector("title[data-i18n-doc]");
  if (title) document.title = t(title.dataset.i18nDoc); // e.g. "IC Heren 1 · Beschikbaarheid"
}

function chooseTeam(id) {
  TEAM_ID = id;
  pref.set("team", id);
  location.href = location.pathname + "?t=" + encodeURIComponent(id);
}

// Kick off: with login, wait for the user; otherwise connect straight away.
function start() {
  const cached = cachedTeamInfo();
  mergeTeamInfo(cached);
  brandUnknown = !!TEAM_ID && !NO_TEAM_PAGE && !cached;
  applyStaticTexts();
  applyBranding();
  injectAuthUI();
  if (!NO_TEAM_PAGE) {
    injectCountdown();
    injectPhonePrompt();
  }
  document.body.insertAdjacentHTML("beforeend", `<footer class="site-footer">${t("footer")}</footer>`);
  injectShareDialog();
  if (AUTH_ON) initAuth(); else if (!NO_TEAM_PAGE) connect(); else render();
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
    history.replaceState(null, "", location.pathname + (TEAM_ID ? `?t=${TEAM_ID}` : ""));
  }
  // Coming back from a Google redirect: success arrives via onAuthStateChanged; surface failures.
  A.getRedirectResult(fbAuth).catch(() =>
    gateMessage(t("auth.redirectFailed"), true));
  A.onAuthStateChanged(fbAuth, user => {
    session.user = user;
    session.platformAdmin = !!user && user.emailVerified && PLATFORM.includes((user.email || "").toLowerCase());
    session.admin = session.platformAdmin;
    session.pid = null;
    session.pending = false;
    session.picking = false;
    session.ready = !user; // with a user, wait until we know the team and the membership
    Object.assign(profile, { data: null, teams: {}, pending: null, applied: false, ready: null });
    if (user) afterSignIn(); else { stopApprovalWatch(); disconnect(); brandUnknown = false; applyBranding(); }
    renderAuth();
    render();
  });
}

// Signed in: load "my teams", pick the team, then check membership in it.
async function afterSignIn() {
  const uid = session.user.uid;
  const mine = (await getAbs(`users/${uid}/teams`)) || {};
  session.teams = Object.keys(mine);
  profile.ready = loadProfile(mine).catch(() => {});
  if (session.platformAdmin) {
    const all = (await getAbs("teams")) || {};
    session.teams = [...new Set([...session.teams, ...Object.keys(all)])];
  }
  if (NO_TEAM_PAGE) { session.ready = true; renderAuth(); render(); return; }
  if (!TEAM_ID && session.teams.length === 1 && !WANT_PICKER) return chooseTeam(session.teams[0]);
  if (!TEAM_ID) return showPicker();
  checkMembership();
}

// Team chooser ("My teams"): shown when no team is chosen yet, or via "switch team".
async function showPicker(message) {
  session.picking = true;
  session.ready = true;
  brandUnknown = false;
  applyBranding(); // no team (yet): the RostiQ header
  session.pickerTeams = await Promise.all((session.teams || []).map(async id => ({ id, info: (await getAbs(`teams/${id}/info`)) || {} })));
  session.pickerTeams.sort((a, b) => (a.info.brand || a.id).localeCompare(b.info.brand || b.id));
  if (message) gateMsg = { text: message, err: true };
  renderAuth();
}

// Only accounts the team admin linked to a player (teams/{t}/members/{uid}) may read the team.
// Others get the "waiting for approval" screen and can send a request with their name.
let approvalEs = null;
function stopApprovalWatch() { if (approvalEs) approvalEs.close(); approvalEs = null; }

async function checkMembership() {
  const uid = session.user.uid;
  const info = await getAbs(`teams/${TEAM_ID}/info`);
  if (!info) { pref.set("team", ""); TEAM_ID = ""; return showPicker(t("pick.notFound")); }
  mergeTeamInfo(info);
  applyBranding();
  pref.set("team", TEAM_ID);
  if (!session.platformAdmin) {
    const [pid, isAdmin] = await Promise.all([getAbs(`teams/${TEAM_ID}/members/${uid}`), getAbs(`teams/${TEAM_ID}/admins/${uid}`)]);
    session.admin = isAdmin === true;
    if (!pid && !session.admin) {
      session.request = await getAbs(`teams/${TEAM_ID}/requests/${uid}`);
      session.pending = true;
      session.ready = true;
      renderAuth();
      watchApproval(uid);
      return;
    }
  }
  session.pending = false;
  connect();
}

// Open the team by itself as soon as the team admin links this account.
async function watchApproval(uid) {
  stopApprovalWatch();
  const stream = approvalEs = new EventSource(await dbUrl(`members/${uid}`));
  stream.addEventListener("put", e => {
    const { data } = JSON.parse(e.data);
    if (!data || stream !== approvalEs) return;
    stopApprovalWatch();
    session.pending = false;
    session.ready = false;
    if (!session.teams.includes(TEAM_ID)) session.teams.push(TEAM_ID);
    renderAuth();
    connect();
  });
  stream.addEventListener("auth_revoked", () => watchApproval(uid));
}

// ---- Login UI ----
function injectAuthUI() {
  const brand = document.querySelector(".brand-inner");
  brand.insertAdjacentHTML("beforeend", `<div class="corner">
    <div class="account" id="account" hidden></div>
    <div class="lang" id="lang" role="group" aria-label="Language">${langButtons()}</div></div>`);
  brand.querySelector(".corner").addEventListener("click", ev => {
    const b = ev.target.closest("[data-lang]");
    if (!b || b.dataset.lang === LANG) return;
    pref.set("lang", b.dataset.lang);
    location.reload();
  });
  // Account menu: open/close, and close on a click elsewhere or Escape.
  document.addEventListener("click", ev => {
    const btn = ev.target.closest("#acct-btn");
    if (btn) { acctOpen = !acctOpen; renderAccount(); return; }
    if (acctOpen && !ev.target.closest("#acct-menu")) { acctOpen = false; renderAccount(); }
  });
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && acctOpen) { acctOpen = false; renderAccount(); document.getElementById("acct-btn")?.focus(); } });
  document.querySelector("main").insertAdjacentHTML("beforebegin", `<section class="gate" id="gate" hidden></section>`);
  if (!NO_TEAM_PAGE) document.querySelector("main .sub").insertAdjacentHTML("afterend",
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

const appUrl = file => location.href.split(/[?#]/)[0].replace(/[^/]*$/, file);

// ---- Account menu in the header (avatar button → name, role, switch team, RostiQ, language, sign out) ----
let acctOpen = false;
const langButtons = () => `<button data-lang="nl" aria-pressed="${LANG === "nl"}">NL</button><button data-lang="en" aria-pressed="${LANG === "en"}">EN</button>`;
function renderAccount() {
  const acct = document.getElementById("account"), u = session.user;
  if (!acct) return;
  if (!u) { acct.innerHTML = ""; acctOpen = false; return; }
  const name = session.pid && root.players && root.players[session.pid] && root.players[session.pid].name || "";
  const label = name || u.email || "";
  const switchable = (session.teams || []).length > 1 || session.platformAdmin;
  const role = session.platformAdmin ? t("menu.rolePlatform") : session.admin ? t("menu.roleAdmin") : t("menu.rolePlayer");
  const initialsOf = s => String(s).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  acct.innerHTML = `<button class="acct-btn" id="acct-btn" aria-haspopup="menu" aria-expanded="${acctOpen}" aria-label="${esc(t("menu.open"))}">
      <span class="avatar-sm" style="background:${avColor(name || u.email || "")}">${esc(initialsOf(label))}</span>
      <span class="nm">${esc(name || t("menu.account"))}</span>${ic("chevron-down")}</button>
    <div class="acct-menu" id="acct-menu" role="menu"${acctOpen ? "" : " hidden"}>
      <div class="menu-head"><b>${esc(label)}</b>${name && u.email ? `<span>${esc(u.email)}</span>` : ""}
        <span class="pill ${session.platformAdmin ? "dark" : session.admin ? "cyan" : "gray"}">${role}</span></div>
      ${switchable && TEAM_ID ? `<a class="menu-item" role="menuitem" href="${appUrl("index.html")}?pick">${ic("switch")} ${t("pick.switch")}</a>` : ""}
      ${session.platformAdmin ? `<a class="menu-item" role="menuitem" href="${appUrl("rostiq.html")}">${ic("settings")} ${t("menu.platform")}</a>` : ""}
      <div class="menu-lang"><span>${t("menu.language")}</span><div class="lang">${langButtons()}</div></div>
      <button class="menu-item danger" role="menuitem" data-signout>${ic("x")} ${t("auth.signOut")}</button>
    </div>`;
}

function renderAuth() {
  if (!AUTH_ON) return;
  const gate = document.getElementById("gate"), main = document.querySelector("main"), acct = document.getElementById("account");
  const u = session.user;
  const picking = u && session.picking && !NO_TEAM_PAGE;
  const needClaim = u && !picking && !NO_TEAM_PAGE && (session.pending || (session.ready && !session.pid && !session.admin));
  const showGate = !u || picking || needClaim;
  gate.hidden = !showGate;
  // Pages with skeleton placeholders show right away; others wait until the data is in.
  main.hidden = showGate || (u && !session.ready && !window.SKELETON_PAGE);

  document.querySelectorAll(".admin-tab").forEach(a => { a.hidden = !session.admin; });
  acct.hidden = !u;
  document.getElementById("lang").hidden = !!u; // signed in: the language is in the account menu
  renderAccount();

  document.body.classList.toggle("gated", !!showGate); // no tabs to go to yet
  const msg = !gateMsg.text ? ""
    : gateMsg.err ? `<p class="gate-msg err">${ic("x")} <span>${esc(gateMsg.text)}</span></p>`
    : `<div class="gate-callout">${ic("mail")} <span>${esc(gateMsg.text)}</span></div>`;
  // Top band: the team's logo/colours when known (signed in, or remembered on this device), else RostiQ.
  const teamKnown = TEAM_ID && !NO_TEAM_PAGE && teamInfoKnown;
  const band = (sub = "") => `<div class="gate-brand">${teamKnown
      ? (TEAM.logo ? `<img src="${esc(TEAM.logo)}" alt="${esc(TEAM.brand)}">` : `<span class="gate-team">${esc(TEAM.brand)}</span>`)
      : `<img src="assets/rostiq-logo-header.png" alt="RostiQ">`}
    ${sub ? `<p>${sub}</p>` : ""}</div>`;
  const signOutRow = extra => `<p class="gate-foot">${extra || ""}<button class="link" data-signout-gate>${t("auth.signOut")}</button></p>`;
  if (!u) {
    gate.innerHTML = `<div class="gate-card">
      ${band(teamKnown ? esc(TEAM.season || "") : t("gate.tagline"))}
      <div class="gate-body">
        <h1>${t("auth.signIn")}</h1>
        <p class="sub">${t("auth.signInSub")}</p>
        <button class="google" data-google>
          <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          ${t("auth.google")}</button>
        <div class="or"><span>${t("auth.orEmail")}</span></div>
        <form class="email-form stacked">
          <input type="email" name="email" required placeholder="you@example.com" autocomplete="email" value="${esc(pref.get("signinEmail", ""))}">
          <button type="submit" class="primary">${ic("mail")} ${t("auth.sendLink")}</button>
        </form>
        ${msg}
        <ul class="gate-features">
          <li>${ic("check")} ${t("gate.feat1")}</li><li>${ic("car")} ${t("gate.feat2")}</li><li>${ic("calendar-plus")} ${t("gate.feat3")}</li>
        </ul>
        <p class="hint">${t(standalone() ? "auth.hintApp" : "auth.hintBrowser")}</p>
      </div>
    </div>`;
  } else if (picking) {
    const list = session.pickerTeams || [];
    gate.innerHTML = `<div class="gate-card">
      ${band(t("gate.tagline"))}
      <div class="gate-body">
        <h1>${t("pick.title")}</h1>
        ${msg}
        ${list.length ? `<div class="team-list">${list.map(x => {
          const c = (x.info.colors && x.info.colors.light && x.info.colors.light["--brand"]) || BRAND_PRESETS[0][1];
          return `<button data-team="${esc(x.id)}"><span class="team-swatch" style="background:${HEX.test(c) ? c : BRAND_PRESETS[0][1]}">${esc(initials0(x.info.brand || x.id))}</span>
            <span class="team-name"><b>${esc(x.info.brand || x.id)}</b>${x.info.season ? `<small>${esc(x.info.season)}</small>` : ""}</span>${ic("arrow-right")}</button>`;
        }).join("")}</div>` : `<p class="sub">${t("pick.none")}</p>`}
        ${signOutRow(session.platformAdmin ? `<a href="${appUrl("rostiq.html")}">${ic("settings")} ${t("pick.manage")}</a> · ` : "")}
      </div>
    </div>`;
  } else if (needClaim) {
    const r = session.request, sent = !!(r && r.name);
    const step = (n, label, state) => `<li class="${state}"><span>${state === "done" ? ic("check") : n}</span>${label}</li>`;
    gate.innerHTML = `<div class="gate-card">
      ${band(esc(TEAM.season || ""))}
      <div class="gate-body">
        <h1>${t("pending.title")}</h1>
        <ol class="stepper">
          ${step(1, t("gate.step1"), "done")}${step(2, t("gate.step2"), sent ? "done" : "now")}${step(3, t("gate.step3"), sent ? "now" : "")}${step(4, t("gate.step4"), "")}
        </ol>
        <p class="sub">${t("pending.text", { email: esc(u.email || "") })}</p>
        ${sent ? `<div class="gate-callout live">${ic("clock")} <span>${t("pending.sent", { name: esc(r.name) })}</span></div>` : ""}
        <form class="email-form stacked request-form">
          <input name="name" required maxlength="60" autocomplete="name" placeholder="${t("pending.name")}"
            value="${esc((r && r.name) || u.displayName || "")}">
          <button type="submit" class="${sent ? "" : "primary"}">${ic("send")} ${t(sent ? "pending.update" : "pending.send")}</button>
        </form>
        ${msg}
        ${signOutRow((session.teams || []).length ? `<a href="${appUrl("index.html")}?pick">${ic("switch")} ${t("pick.switch")}</a> · ` : "")}
      </div>
    </div>`;
  }
}
const initials0 = s => String(s).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

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
  const team = ev.target.closest("[data-team]");
  if (team) chooseTeam(team.dataset.team);
  if (ev.target.closest("[data-signout-gate]")) A.signOut(fbAuth);
}

async function onGateSubmit(ev) {
  ev.preventDefault();
  if (ev.target.classList.contains("request-form")) {
    // Ask the team admin for access, with the name the player goes by in the team.
    const u = session.user;
    const req = { email: u.email || "", name: ev.target.name.value.trim().slice(0, 60), at: Date.now() };
    // My details from my other teams travel along, so approval fills them in at once.
    await profile.ready;
    const mine = Object.fromEntries(PROFILE_FIELDS.filter(f => profile.data && profile.data[f] != null).map(f => [f, profile.data[f]]));
    if (Object.keys(mine).length) req.profile = mine;
    try {
      const res = await fetch(await dbUrl(`requests/${u.uid}`), { method: "PUT", body: JSON.stringify(req) });
      if (!res.ok) throw new Error(res.status);
      session.request = req;
      gateMessage("", false);
    } catch {
      gateMessage(t("pending.failed"), true);
    }
    return;
  }
  const email = ev.target.email.value.trim();
  try {
    await A.sendSignInLinkToEmail(fbAuth, email, {
      url: location.origin + location.pathname + (TEAM_ID ? `?t=${TEAM_ID}` : ""), handleCodeInApp: true });
    pref.set("signinEmail", email);
    gateMessage(t("auth.checkEmail", { email }), false);
  } catch (e) {
    gateMessage(t(e.code === "auth/quota-exceeded" ? "auth.quota" : "auth.sendFailed"), true);
  }
}

// ---- Linking accounts to players (team admin) ----
// Team part (player row + membership) first, then the account's "my teams" index.
async function linkAccount(uid, pid, extra = {}) {
  const row = extra[`players/${pid}`] ? {} : { [`players/${pid}/uid`]: uid }; // a new row already carries its uid
  const ok = await update({ ...row, [`members/${uid}`]: pid, ...extra });
  if (ok) await writeAbs(`users/${uid}/teams/${TEAM_ID}`, pid);
  return ok;
}
async function unlinkAccount(uid, pid, extra = {}) {
  await writeAbs(`users/${uid}/teams/${TEAM_ID}`, null);
  return update({ ...(pid ? { [`players/${pid}/uid`]: null } : {}), [`members/${uid}`]: null, [`admins/${uid}`]: null, ...extra });
}

function sortedPlayers() {
  const players = root.players || {};
  return Object.keys(players)
    .map(id => ({ id, ...players[id], avail: players[id].avail || {} }))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
}

const displayName = (p, i) => p.name || t("playerN", { n: i + 1 });

const slug = t => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
