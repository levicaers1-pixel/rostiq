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
const fmt = (d, opts) => parse(d).toLocaleDateString("en-GB", opts);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Per-viewer UI preferences (not shared).
const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

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

async function write(path, value) {
  apply(path, value, false);
  render();
  if (!DB) return;
  try {
    const res = await fetch(`${DB}/${path}.json`, {
      method: value === null ? "DELETE" : "PUT",
      body: value === null ? undefined : JSON.stringify(value),
    });
    if (!res.ok) throw new Error(res.status);
  } catch (e) {
    setStatus("err", "Save failed – check your connection");
  }
}

function setStatus(cls, text) {
  const el = document.getElementById("status");
  el.className = "status " + cls;
  el.textContent = text;
}

function connect() {
  if (!DB) {
    root = { players: defaultPlayers() };
    document.getElementById("banner").hidden = false;
    setStatus("err", "Not connected");
    render();
    return;
  }
  let seeded = false;
  const es = new EventSource(`${DB}/.json`);
  const onEvent = merge => e => {
    const { path, data } = JSON.parse(e.data);
    apply(path, data, merge);
    if (!seeded && path === "/" && !merge) {
      seeded = true;
      if (!root.initialized) {
        // First visit ever: create the 15 default rows. Rules only allow writes
        // per player, so use multi-path keys ("players/p01") rather than a nested object.
        const update = { initialized: true };
        for (const [id, p] of Object.entries(defaultPlayers())) update[`players/${id}`] = p;
        fetch(`${DB}/.json`, { method: "PATCH", body: JSON.stringify(update) });
      }
    }
    setStatus("live", "Live");
    render();
  };
  es.addEventListener("put", onEvent(false));
  es.addEventListener("patch", onEvent(true));
  es.addEventListener("cancel", () => setStatus("err", "Access denied – check database rules"));
  es.onopen = () => setStatus("live", "Live");
  es.onerror = () => setStatus("err", "Reconnecting…");
}

function sortedPlayers() {
  const players = root.players || {};
  return Object.keys(players)
    .map(id => ({ id, ...players[id], avail: players[id].avail || {} }))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id));
}

const displayName = (p, i) => p.name || `Player ${i + 1}`;

const slug = t => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
