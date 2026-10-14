// RostiQ: calendar invitations by email (iTIP over SMTP, sent through Brevo).
//
// A player opts in from the app's calendar dialog: inviteSubs/<team>/<player> = { e: their verified login email, l: lang, at }.
// Every run (each 10 minutes) this compares each upcoming match (next 8 weeks) with what that player last received
// (inviteLog/<team>/<player>/<date> = { h: hash sent, s: sequence, p: hash seen last run }) and sends:
//   - a REQUEST for a new match, or an updated one (SEQUENCE + 1): the event appears/moves in their own calendar;
//   - a CANCEL when a match disappears from the schedule: the event is removed.
// Changes are only sent once they've been stable for one run (p === current), so a captain editing a match three times
// in a row sends one email. inviteLog is only readable/writable by this job (Admin SDK); the rules give clients nothing.
import crypto from "node:crypto";
import nodemailer from "nodemailer";

const APP = "https://app.rostiq.be";
const FROM_ADDR = process.env.INVITE_FROM || "agenda@rostiq.be";
const WINDOW_DAYS = 56;            // invite up to 8 weeks ahead
const MAX_PER_RUN = 120;           // stay well inside Brevo's free 300 emails/day; the rest goes next run
const SPORTS = { golf: { hours: 5, allDay: ["09:00", "17:00"] }, tennis: { hours: 4 } };
const hoursOf = sport => (SPORTS[sport] || {}).hours || 2;

const TEXT = {
  nl: { newS: (l, o, w) => `📅 ${l} · ${o}, ${w}`, updS: (l, o, w) => `Gewijzigd: ${l} · ${o}, ${w}`, canS: (l, o, w) => `Afgelast: ${l} · ${o}, ${w}`,
    newB: "Deze wedstrijd staat nu in je agenda.", updB: "De wedstrijd is gewijzigd. Je agenda is bijgewerkt.", canB: "Deze wedstrijd gaat niet door en is uit je agenda gehaald.",
    answer: "Laat weten of je erbij bent", meet: "Verzamelen", home: "Thuiswedstrijd", away: "Uitwedstrijd", final: "(finale)",
    why: "Je krijgt deze uitnodigingen omdat je ze aanzette in RostiQ. Uitzetten kan in de app, bij Alles in je agenda.", locale: "nl-BE" },
  fr: { newS: (l, o, w) => `📅 ${l} · ${o}, ${w}`, updS: (l, o, w) => `Modifié : ${l} · ${o}, ${w}`, canS: (l, o, w) => `Annulé : ${l} · ${o}, ${w}`,
    newB: "Ce match est maintenant dans ton agenda.", updB: "Le match a changé. Ton agenda est mis à jour.", canB: "Ce match n'a pas lieu et a été retiré de ton agenda.",
    answer: "Dis si tu seras là", meet: "Rendez-vous", home: "Match à domicile", away: "Match à l'extérieur", final: "(finale)",
    why: "Tu reçois ces invitations parce que tu les as activées dans RostiQ. Tu peux les désactiver dans l'app, sous Ajouter à l'agenda.", locale: "fr-BE" },
  en: { newS: (l, o, w) => `📅 ${l} · ${o}, ${w}`, updS: (l, o, w) => `Changed: ${l} · ${o}, ${w}`, canS: (l, o, w) => `Cancelled: ${l} · ${o}, ${w}`,
    newB: "This match is now in your calendar.", updB: "The match has changed. Your calendar has been updated.", canB: "This match is off and has been removed from your calendar.",
    answer: "Let the team know if you're in", meet: "Meeting", home: "Home match", away: "Away match", final: "(final)",
    why: "You get these invitations because you switched them on in RostiQ. Switch them off in the app, under Add to calendar.", locale: "en-GB" },
};
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Brussels",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE"];
const icsText = s => String(s).replace(/[\\;,]/g, c => "\\" + c).replace(/\r\n|\r|\n/g, "\\n");
const fold = line => line.length <= 70 ? line : line.match(/.{1,70}/gu).join("\r\n ");
const venueText = v => (v ? [v.name, v.address].filter(Boolean).join(", ") : "");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
const plusDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// What makes up a match as far as the invitation is concerned (a change in any of these sends an update).
function matchFacts(team, date) {
  const e = (team.schedule || {})[date] || {}, m = (team.matches || {})[date] || {}, info = team.info || {};
  const v = m.venue || null;
  return { label: info.calendarLabel || info.shortName || info.brand || "RostiQ", opp: e.opp || "", home: e.home ?? null, final: !!e.final,
    start: m.start || "", end: m.end || "", venue: v ? { name: v.name || "", address: v.address || "" } : null, meet: m.meet || "", info: m.info || "",
    sport: (team.settings || {}).sport || "golf" };
}
const hashOf = f => crypto.createHash("sha1").update(JSON.stringify(f)).digest("hex").slice(0, 16);

export function buildInvite({ tid, date, f, seq, method, to, name, lang }) {
  const T = TEXT[lang] || TEXT.nl, d = date.replace(/-/g, "");
  const sp = SPORTS[f.sport] || {};
  const allDay = !f.start && !sp.allDay;
  const start = f.start || (sp.allDay || ["09:00"])[0];
  const end = f.end || (f.start ? `${String(Math.min(23, Number(f.start.slice(0, 2)) + hoursOf(f.sport))).padStart(2, "0")}${f.start.slice(2)}` : (sp.allDay || ["", "17:00"])[1]);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const appUrl = `${APP}/?t=${encodeURIComponent(tid)}`;
  const desc = [f.home === true ? T.home : f.home === false ? T.away : "", f.meet && `${T.meet}: ${f.meet}`, f.info, `${T.answer}: ${appUrl}`].filter(Boolean).join("\n");
  const lines = ["BEGIN:VCALENDAR", "PRODID:-//Caersultancy//RostiQ//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", `METHOD:${method}`, ...VTIMEZONE,
    "BEGIN:VEVENT",
    `UID:${d}@${tid}.rostiq-invite`,   // one per team and date: a renamed opponent updates the same event
    `SEQUENCE:${seq}`, `DTSTAMP:${stamp}`,
    ...(allDay ? [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${plusDays(date, 1).replace(/-/g, "")}`]
      : [`DTSTART;TZID=Europe/Brussels:${d}T${start.replace(":", "")}00`, `DTEND;TZID=Europe/Brussels:${d}T${end.replace(":", "")}00`]),
    `SUMMARY:${icsText(`${f.label} · ${f.opp}${f.final ? " " + T.final : ""}`)}`,
    `LOCATION:${icsText(f.venue ? venueText(f.venue) : f.opp)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `URL:${appUrl}`,
    `ORGANIZER;CN=RostiQ:mailto:${FROM_ADDR}`,
    `ATTENDEE;CN=${icsText(name || to)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${to}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT", "END:VCALENDAR"];
  return lines.map(fold).join("\r\n") + "\r\n";
}

function emailFor({ tid, date, f, kind, lang }) {
  const T = TEXT[lang] || TEXT.nl;
  const when = new Date(date + "T12:00:00Z").toLocaleDateString(T.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const subject = (kind === "new" ? T.newS : kind === "upd" ? T.updS : T.canS)(f.label, f.opp, when);
  const body = kind === "new" ? T.newB : kind === "upd" ? T.updB : T.canB;
  const appUrl = `${APP}/?t=${encodeURIComponent(tid)}`;
  const details = [f.start && `${f.start}${f.end ? "–" + f.end : ""}`, f.venue && venueText(f.venue), f.meet && `${T.meet}: ${f.meet}`].filter(Boolean);
  const text = [body, "", `${f.label} · ${f.opp}`, when, ...details, "", kind === "can" ? "" : `${T.answer}: ${appUrl}`, "", T.why].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>${esc(body)}</p><p><b>${esc(f.label)} · ${esc(f.opp)}</b><br>${esc(when)}${details.map(x => "<br>" + esc(x)).join("")}</p>
${kind === "can" ? "" : `<p><a href="${appUrl}" style="color:#2f2a8f;font-weight:600">${esc(T.answer)} →</a></p>`}
<p style="color:#777;font-size:12px">${esc(T.why)}</p></div>`;
  return { subject, text, html };
}

/** One pass over all teams. Returns the database writes to make (merged into the job's own update). */
export async function runInvites({ teams, subs, log, today, dry, verbose }) {
  const writes = {}, stats = { sent: 0, updated: 0, cancelled: 0, waiting: 0, failed: 0 };
  const user = (process.env.BREVO_SMTP_LOGIN || "").trim(), pass = (process.env.BREVO_SMTP_KEY || "").trim(); // pasted secrets often carry a newline
  const anySubs = Object.values(subs || {}).some(x => x && Object.keys(x).length);
  if (!anySubs) return { writes, stats };
  if (!dry && process.env.INVITE_TRANSPORT !== "stream" && (!user || !pass)) { console.log("Invitations: not set up yet (secrets BREVO_SMTP_LOGIN / BREVO_SMTP_KEY missing): nothing sent."); return { writes, stats }; }
  // INVITE_TRANSPORT=stream (tests): build the emails and print them instead of sending.
  const stream = process.env.INVITE_TRANSPORT === "stream";
  const mail = dry ? null : nodemailer.createTransport(stream ? { streamTransport: true, buffer: true, newline: "unix" }
    : { host: "smtp-relay.brevo.com", port: 587, secure: false, auth: { user, pass } });
  const until = plusDays(today, WINDOW_DAYS);
  let budget = MAX_PER_RUN;

  async function send(to, msg, ics, method) {
    if (dry) { if (verbose) console.log(method, to.replace(/^(.).*@/, "$1…@"), msg.subject); return true; }
    try {
      const info = await mail.sendMail({ from: { name: "RostiQ", address: FROM_ADDR }, to, subject: msg.subject, text: msg.text, html: msg.html,
        icalEvent: { method: method.toLowerCase(), filename: method === "CANCEL" ? "cancel.ics" : "invite.ics", content: ics } });
      if (info && info.message && process.env.INVITE_TRANSPORT === "stream") console.log("=====MAIL=====\n" + info.message.toString());
      return true;
    } catch (e) { stats.failed++; console.warn("invite send failed:", (e && (e.responseCode || e.code)) || "error"); return false; }
  }

  for (const [tid, perTeam] of Object.entries(subs || {})) {
    const team = teams[tid];
    for (const [pid, sub] of Object.entries(perTeam || {})) {
      const player = team && (team.players || {})[pid];
      const mine = ((log || {})[tid] || {})[pid] || {};
      // Gone: the team, the player, or the address changed since the log was made -> start over quietly.
      if (!team || !player || !player.name || !sub || typeof sub.e !== "string") { writes[`inviteLog/${tid}/${pid}`] = null; continue; }
      const lang = TEXT[sub.l] ? sub.l : "nl";
      const dates = Object.keys(team.schedule || {}).filter(d => isDate(d) && d >= today && d <= until && (team.schedule[d] || {}).opp).sort();
      // New subscriber (or a new address): start a fresh log, every match waiting one run before it's sent.
      if (mine._e !== sub.e) {
        writes[`inviteLog/${tid}/${pid}`] = { _e: sub.e, ...Object.fromEntries(dates.map(d => [d, { p: hashOf(matchFacts(team, d)) }])) };
        stats.waiting += dates.length;
        continue;
      }
      const known = mine;
      for (const date of dates) {
        const f = matchFacts(team, date), h = hashOf(f), L = known[date] || {};
        if (L.h === h) continue;                                     // they have this version
        if (L.p !== h) { writes[`inviteLog/${tid}/${pid}/${date}/p`] = h; stats.waiting++; continue; } // wait one run
        if (budget <= 0) continue;
        const seq = typeof L.s === "number" ? L.s + 1 : 0, kind = typeof L.s === "number" ? "upd" : "new";
        const ok = await send(sub.e, emailFor({ tid, date, f, kind, lang }), buildInvite({ tid, date, f, seq, method: "REQUEST", to: sub.e, name: player.name, lang }), "REQUEST");
        budget--;
        if (ok) { writes[`inviteLog/${tid}/${pid}/${date}`] = { h, s: seq, o: f.opp.slice(0, 60) }; stats[kind === "new" ? "sent" : "updated"]++; }
      }
      for (const [date, L] of Object.entries(known)) {
        if (!isDate(date)) continue;
        if (date < today) { writes[`inviteLog/${tid}/${pid}/${date}`] = null; continue; }                 // played: forget
        if ((team.schedule || {})[date] && (team.schedule[date] || {}).opp) continue;                       // still on
        if (typeof L.s !== "number") { writes[`inviteLog/${tid}/${pid}/${date}`] = null; continue; }        // never sent
        if (budget <= 0) continue;
        const f = { ...matchFacts({ ...team, schedule: { [date]: { opp: L.o || "?" } } }, date) };
        const ok = await send(sub.e, emailFor({ tid, date, f, kind: "can", lang }), buildInvite({ tid, date, f, seq: L.s + 1, method: "CANCEL", to: sub.e, name: player.name, lang }), "CANCEL");
        budget--;
        if (ok) { writes[`inviteLog/${tid}/${pid}/${date}`] = null; stats.cancelled++; }
      }
    }
  }
  // Players who switched invitations off: forget their log (their calendar keeps what it has).
  for (const [tid, perTeam] of Object.entries(log || {})) for (const pid of Object.keys(perTeam || {}))
    if (!((subs || {})[tid] || {})[pid]) writes[`inviteLog/${tid}/${pid}`] = null;
  if (mail) mail.close();
  return { writes, stats };
}
