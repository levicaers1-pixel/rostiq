// RostiQ: a player's personal calendar feed (iCalendar), built from the team's data.
// Same times and defaults as the app's .ics download (index.html, buildIcs), plus the player's own answer in each
// title and their carpool in the description. Pure function: easy to test without a database.
import { roleOf, roleText } from "./lineup.js";
import { trainingDates, trainComing } from "./training.js";

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Brussels",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
  "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET",
  "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];
// How long a match day takes, and golf's default day (as in the app's SPORTS table).
const SPORTS = {
  golf: { hours: 5, allDay: ["09:00", "17:00"] }, tennis: { hours: 4 }, padel: { hours: 2 }, hockey: { hours: 2 },
  football: { hours: 2 }, basketball: { hours: 2 }, volleyball: { hours: 2 }, other: { hours: 2 },
};
const APP = "https://app.rostiq.be";

const TEXT = {
  nl: {
    training: "Training", trOff: "Afgelast", trYes: "Je komt", trNo: "Je komt niet",
    selected: "Geselecteerd",
    yes: "Je bent erbij", maybe: "Je antwoord: misschien", no: "Je kan niet", none: "Je hebt nog niet geantwoord",
    todo: "nog antwoorden", off: "Afgelast", final: "(finale)", home: "Thuiswedstrijd", away: "Uitwedstrijd", meet: "Verzamelen",
    answer: "Antwoorden of aanpassen", driving: "Jij rijdt", drivingWith: n => `Jij rijdt, met ${n}`, ridingWith: n => `Je rijdt mee met ${n}`,
    needRide: "Je zoekt nog een lift", seats: n => `${n} vrije ${n === 1 ? "plaats" : "plaatsen"}`, name: b => `${b} · RostiQ`,
  },
  fr: {
    training: "Entraînement", trOff: "Annulé", trYes: "Tu viens", trNo: "Tu ne viens pas",
    selected: "Sélectionné",
    yes: "Tu es là", maybe: "Ta réponse : peut-être", no: "Tu ne peux pas", none: "Tu n'as pas encore répondu",
    todo: "à répondre", off: "Annulé", final: "(finale)", home: "Match à domicile", away: "Match à l'extérieur", meet: "Rendez-vous",
    answer: "Répondre ou modifier", driving: "Tu conduis", drivingWith: n => `Tu conduis, avec ${n}`, ridingWith: n => `Tu montes avec ${n}`,
    needRide: "Tu cherches encore un trajet", seats: n => `${n} ${n < 2 ? "place libre" : "places libres"}`, name: b => `${b} · RostiQ`,
  },
  en: {
    training: "Training", trOff: "Called off", trYes: "You're coming", trNo: "You're not coming",
    selected: "Selected",
    yes: "You're in", maybe: "Your answer: maybe", no: "You can't make it", none: "You haven't answered yet",
    todo: "answer needed", off: "Called off", final: "(final)", home: "Home match", away: "Away match", meet: "Meeting",
    answer: "Answer or change", driving: "You're driving", drivingWith: n => `You're driving, with ${n}`, ridingWith: n => `You ride with ${n}`,
    needRide: "You still need a ride", seats: n => `${n} free ${n === 1 ? "seat" : "seats"}`, name: b => `${b} · RostiQ`,
  },
};
const MARK = { yes: "✅", maybe: "❔", no: "❌", "": "❓" };

const icsText = s => String(s).replace(/[\\;,]/g, c => "\\" + c).replace(/\r\n|\r|\n/g, "\\n");
const hhmmss = hm => hm.replace(":", "") + "00";
const fold = line => line.length <= 70 ? line : line.match(/.{1,70}/gu).join("\r\n ");
const slug = t => String(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
const venueText = v => (v ? [v.name, v.address].filter(Boolean).join(", ") : "");
const mapsUrl = v => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(venueText(v) || (v.lat != null ? `${v.lat},${v.lon}` : ""));
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
const nameList = (names, lang) => names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + ({ nl: " en ", fr: " et ", en: " and " }[lang]) + names.at(-1);

/**
 * team: { tid, info, settings, schedule, matches, carpool }, player: { pid, name, avail }, names: { pid: name },
 * opts: { lang, hideNo, today: "YYYY-MM-DD", now: Date }
 */
// A published selection adds the player's role ("Selected. Position: defence."; "You're reserve 1.").
export function buildFeed(team, player, names, opts) {
  const lang = TEXT[opts.lang] ? opts.lang : "nl", T = TEXT[lang];
  const info = team.info || {}, settings = team.settings || {};
  const sp = SPORTS[settings.sport] || SPORTS.golf; // existing teams without a sport: golf, as in the app
  const label = info.calendarLabel || info.shortName || info.brand || "RostiQ";
  const avail = player.avail || {};
  const stamp = (opts.now || new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const from = new Date(Date.parse(opts.today + "T12:00:00Z") - 60 * 864e5).toISOString().slice(0, 10); // the last two months too
  const uidDomain = team.tid === "pampas-wintermidam" ? "team-availability" : `${team.tid}.rostiq`;
  const appUrl = `${APP}/?t=${encodeURIComponent(team.tid)}`;
  const nameOf = id => names[id] || "?";

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Caersultancy//RostiQ//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(T.name(info.brand || label))}`, `NAME:${icsText(T.name(info.brand || label))}`,
    "X-WR-TIMEZONE:Europe/Brussels", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", ...VTIMEZONE];

  for (const date of Object.keys(team.schedule || {}).filter(isDate).sort()) {
    if (date < from) continue;
    const e = team.schedule[date] || {};
    if (!e.opp) continue;
    const status = ["yes", "maybe", "no"].includes(avail[date]) ? avail[date] : "";
    if (opts.hideNo && status === "no") continue;
    const m = (team.matches || {})[date] || {}, v = m.venue;
    const d = date.replace(/-/g, "");
    const allDay = !m.start && !sp.allDay;
    const start = m.start || (sp.allDay || ["09:00"])[0];
    const end = m.end || (m.start ? `${String(Math.min(23, Number(m.start.slice(0, 2)) + sp.hours)).padStart(2, "0")}${m.start.slice(2)}` : (sp.allDay || ["", "17:00"])[1]);
    const nextDay = new Date(Date.parse(date + "T12:00:00Z") + 864e5).toISOString().slice(0, 10).replace(/-/g, "");

    // My carpool for this match
    const cp = (team.carpool || {})[date] || {}, mine = cp[player.pid];
    let ride = "";
    if (mine && mine.role === "driver") {
      const riders = Object.entries(cp).filter(([id, x]) => x && x.role === "rider" && x.with === player.pid).map(([id]) => nameOf(id));
      const free = Math.max(0, (mine.seats || 1) - riders.length);
      ride = (riders.length ? T.drivingWith(nameList(riders, lang)) : T.driving) + (free ? ` · ${T.seats(free)}` : "") + (mine.note ? ` · ${mine.note}` : "");
    } else if (mine && mine.role === "rider") {
      const drv = mine.with && cp[mine.with] && cp[mine.with].role === "driver" ? mine.with : null;
      ride = drv ? T.ridingWith(nameOf(drv)) + (cp[drv].note ? ` · ${cp[drv].note}` : "") : T.needRide;
    }

    const sm = (team.selection || {})[date], role = sm && sm.pub && !e.cancelled ? roleOf(sm, player.pid) : null;
    const sel = role ? (role.k === "s" ? [T.selected + ".", roleText(role, lang, role.mate ? String(nameOf(role.mate)).split(/\s+/)[0] : "")].filter(Boolean).join(" ") : roleText(role, lang)) : "";

    // Called off: stays in the calendar, marked as cancelled (most apps strike it through).
    const off = e.cancelled === true;
    const summary = off ? `❌ ${T.off}: ${label} · ${e.opp}${e.final ? " " + T.final : ""}`
      : `${MARK[status]} ${label} · ${e.opp}${e.final ? " " + T.final : ""}${status ? "" : " · " + T.todo}`;
    const desc = [
      off ? T.off : T[status || "none"],
      e.home === true ? T.home : e.home === false ? T.away : "",
      m.meet && `${T.meet}: ${m.meet}`,
      ride && `🚗 ${ride}`,
      sel && `📋 ${sel}`,
      m.info,
      v && mapsUrl(v),
      `${T.answer}: ${appUrl}`,
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d}-${slug(e.opp)}@${uidDomain}`,
      `DTSTAMP:${stamp}`,
      ...(allDay ? [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${nextDay}`]
        : [`DTSTART;TZID=Europe/Brussels:${d}T${hhmmss(start)}`, `DTEND;TZID=Europe/Brussels:${d}T${hhmmss(end)}`]),
      `STATUS:${off ? "CANCELLED" : status === "maybe" ? "TENTATIVE" : "CONFIRMED"}`,
      `TRANSP:${off || status === "no" ? "TRANSPARENT" : "OPAQUE"}`,
      `SUMMARY:${icsText(summary)}`,
      `LOCATION:${icsText(v ? venueText(v) : e.opp)}`,
      ...(v && v.lat != null ? [`GEO:${v.lat};${v.lon}`] : []),
      `DESCRIPTION:${icsText(desc)}`,
      `URL:${appUrl}`,
      "END:VEVENT");
  }
  // Trainings for the next eight weeks (settings/train), with the player's own answer; a day called off stays, cancelled.
  const train = settings.train, ans = player.tr || {};
  const until = new Date(Date.parse(opts.today + "T12:00:00Z") + 56 * 864e5).toISOString().slice(0, 10);
  for (const tr of trainingDates(train, team.trainings, opts.today, until)) {
    const coming = trainComing(train, ans[tr.date]), d = tr.date.replace(/-/g, "");
    if (opts.hideNo && !tr.off && ans[tr.date] === "no") continue;
    const end = tr.end || `${String(Math.min(23, Number(tr.start.slice(0, 2)) + 1)).padStart(2, "0")}${tr.start.slice(2)}`;
    const mark = tr.off ? "❌" : coming ? "✅" : ans[tr.date] === "no" ? "❌" : "❔";
    const desc = [tr.off ? T.trOff : coming ? T.trYes : ans[tr.date] === "no" ? T.trNo : T.none, tr.note, tr.venue && mapsUrl(tr.venue), `${T.answer}: ${appUrl}`].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d}-training-${tr.id}@${uidDomain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Brussels:${d}T${hhmmss(tr.start)}`, `DTEND;TZID=Europe/Brussels:${d}T${hhmmss(end)}`,
      `STATUS:${tr.off ? "CANCELLED" : "CONFIRMED"}`,
      `TRANSP:${tr.off || !coming ? "TRANSPARENT" : "OPAQUE"}`,
      `SUMMARY:${icsText(`${mark} ${tr.off ? T.off + ": " : ""}${label} · ${T.training}`)}`,
      ...(tr.venue ? [`LOCATION:${icsText(venueText(tr.venue))}`] : []),
      ...(tr.venue && tr.venue.lat != null ? [`GEO:${tr.venue.lat};${tr.venue.lon}`] : []),
      `DESCRIPTION:${icsText(desc)}`,
      `URL:${appUrl}`,
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
