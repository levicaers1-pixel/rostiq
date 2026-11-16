// RostiQ carpool: who drives, who rides along, per match (carpool/<date>/<player> = { role: "driver" | "rider",
// seats, note, with: <driver> }). Shared by the match page's Carpool tab (index.html) and the season overview (carpool.html).
const km = (idA, idB) => kmBetween(geoOf(idA), geoOf(idB));

// ---- Data helpers ----
const named = () => sortedPlayers().filter(p => p.name);
const player = id => (root.players && root.players[id]) ? { id, ...root.players[id] } : null;
const nameOf = id => (player(id) || {}).name || "?";
const placeOf = id => (player(id) || {}).gemeente || "";
const geoOf = id => (player(id) || {}).geo || null;
const placeText = id => (geoOf(id) && geoOf(id).label) || placeOf(id);
const entries = e => (root.carpool && root.carpool[e.date]) || {};

// A direct WhatsApp chat from me to another player, with a ready message chosen by who we are in this match ("" without a number).
function cpDmUrl(e, me, other, st) {
  const phone = phoneOf(other);
  if (!me || other === me || !phone) return "";
  const mine = st.all[me] || {}, theirs = st.all[other] || {};
  const vars = { first: firstName(nameOf(other)), opp: e.opp, when: shortDate(e.date), place: placeOf(me), note: mine.note || "" };
  const key =
    mine.role === "driver" && theirs.with === me ? "msg.myRider" :
    mine.role === "driver" ? "msg.offerRide" :
    theirs.role === "driver" && mine.with === other ? "msg.toMyDriver" :
    theirs.role === "driver" ? "msg.askRide" : "msg.carpoolGeneric";
  return waChat(phone, t(key, vars));
}

function matchState(e) {
  const all = entries(e);
  const drivers = Object.keys(all).filter(id => all[id].role === "driver" && player(id));
  const cars = drivers.map(id => ({
    id,
    seats: all[id].seats || 1,
    note: all[id].note || "",
    riders: Object.keys(all).filter(r => all[r].role === "rider" && all[r].with === id && player(r)),
  }));
  const waiting = Object.keys(all).filter(id =>
    all[id].role === "rider" && player(id) && !drivers.includes(all[id].with));
  // Only players who said yes (a "maybe" isn't playing yet); once a selection is published, only the selected ones.
  const sel = (root.selection || {})[e.date], picked = sel && sel.pub ? (sel.p || {}) : null;
  const open = named().filter(p => !all[p.id] && (picked ? picked[p.id] === "s" && (p.avail || {})[e.date] !== "no" : (p.avail || {})[e.date] === "yes")).map(p => p.id);
  return { all, cars, waiting, open };
}

// Suggestions: two drivers who live close together and fit in one car (one car fewer), and riders still waiting who
// live close to a car with room. Straight-line distance between homes; only players whose place is known.
const NEAR_KM = 10;
function suggestions(st) {
  const out = [], merged = new Set(), hostOf = new Set();
  const cars = st.cars.filter(c => geoOf(c.id)).map(c => ({ ...c, free: c.seats - c.riders.length }));
  const near = (a, b) => { const d = km(a, b); return d !== null && d <= NEAR_KM ? d : null; };
  // The cars with the most room take the others in, nearest first.
  for (const a of [...cars].sort((x, y) => y.free - x.free || y.seats - x.seats)) {
    if (merged.has(a.id)) continue;
    const guests = cars.filter(b => b.id !== a.id && !merged.has(b.id) && !hostOf.has(b.id))
      .map(b => ({ b, d: near(a.id, b.id) })).filter(x => x.d !== null).sort((x, y) => x.d - y.d);
    for (const { b, d } of guests) {
      if (1 + b.riders.length > a.free) continue;
      a.free -= 1 + b.riders.length; merged.add(b.id); hostOf.add(a.id);
      out.push({ kind: "merge", host: a.id, guest: b.id, n: b.riders.length, d });
    }
  }
  for (const r of st.waiting) {
    const best = cars.filter(c => c.free > 0 && !merged.has(c.id)).map(c => ({ c, d: near(c.id, r) }))
      .filter(x => x.d !== null).sort((x, y) => x.d - y.d)[0];
    if (best) { best.c.free--; out.push({ kind: "ride", host: best.c.id, guest: r, d: best.d }); }
  }
  return out;
}
const kmText = d => d.toLocaleString(LOCALE, { maximumFractionDigits: d < 10 ? 1 : 0 });
const suggestionText = s => t(s.kind === "merge" ? "cp.sugMerge" : "cp.sugRide", { a: nameOf(s.host), b: nameOf(s.guest), n: s.n, km: kmText(s.d) });

// ---- Actions for player pid (all write straight to the shared database) ----
function cpSetRole(e, pid, role) {
  const path = `carpool/${e.date}/${pid}`;
  const mineNow = entries(e)[pid];
  if (mineNow && mineNow.role === "driver" && role !== "driver") {
    // Riders in my car go back to the waiting list.
    for (const [id, x] of Object.entries(entries(e))) if (x.with === pid) write(`carpool/${e.date}/${id}/with`, null);
  }
  if (!role) return write(path, null);
  if (role === "driver") return write(path, { role, seats: (mineNow && mineNow.seats) || 3, ...(mineNow && mineNow.note ? { note: mineNow.note } : {}) });
  return write(path, { role });
}
const cpJoin = (e, pid, driverId) => write(`carpool/${e.date}/${pid}`, { role: "rider", with: driverId });
const cpLeave = (e, pid) => write(`carpool/${e.date}/${pid}/with`, null);
const cpTake = (e, pid, riderId) => write(`carpool/${e.date}/${riderId}/with`, pid);
const cpDrop = (e, riderId) => write(`carpool/${e.date}/${riderId}/with`, null);

// Ready-made WhatsApp message with the carpool plan for one match.
function carpoolMessage(e) {
  const st = matchState(e), m = matchInfo(e), v = m.venue;
  const where = id => (placeOf(id) ? ` (${placeOf(id)})` : "");
  const cars = st.cars.map(c => {
    const free = c.seats - c.riders.length;
    return lines([
      `🚗 *${nameOf(c.id)}*${where(c.id)}: ${free > 0 ? t("msg.seatsFree", { n: free }) : t("msg.full")}`,
      c.note && `   🕘 ${c.note}`,
      c.riders.length && `   👥 ${c.riders.map(r => nameOf(r) + where(r)).join(", ")}`,
    ]);
  });
  return lines([
    `*🚗 Carpool: ${e.opp}${e.final ? " " + t("ics.final") : ""}*`,
    `📅 ${fmt(e.date, { weekday: "long", day: "numeric", month: "long" })}${timeText(e) ? " · 🕘 " + timeText(e) : ""}`,
    v && `📍 ${venueText(v)}`,
    v && `🗺️ ${chatMapsUrl(v)}`,
    weatherFor(e) && wxText(weatherFor(e)),
    m.meet && `🚩 ${t("meet")}: ${m.meet}`,
    BLANK,
    cars.length ? cars.join("\n") : t("msg.noCars"),
    st.waiting.length ? BLANK : null,
    st.waiting.length && `${t("msg.waiting")}: ${st.waiting.map(id => nameOf(id) + where(id)).join(", ")}`,
    ...(() => { const sug = suggestions(st); return sug.length ? [BLANK, `💡 ${t("cp.suggest")}:`, ...sug.map(s => `• ${suggestionText(s)}`)] : []; })(),
    st.open.length ? BLANK : null,
    st.open.length && `${t("msg.open")}: ${st.open.map(id => nameOf(id) + where(id)).join(", ")}`,
    BLANK,
    t("msg.carpoolLink", { url: pageUrl("") + `#m/${e.date}/c` }),
  ]);
}
