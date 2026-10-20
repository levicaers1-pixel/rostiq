import { buildFeed } from "./ics.js";
import assert from "node:assert/strict";
const team = { tid: "kfc", info: { brand: "KFC Zuiderpark", shortName: "Zuiderpark" }, settings: { sport: "football" },
  schedule: { "2026-10-18": { opp: "FC Polderzonen", home: false }, "2026-10-25": { opp: "KSV Bosrand", home: true }, "2026-11-01": { opp: "Racing", final: true }, "2026-11-08": { opp: "Nee-match" }, "2025-01-01": { opp: "Old" } },
  matches: { "2026-10-18": { start: "15:00", end: "16:45", meet: "13:45 kantine", venue: { name: "Polderstadion", address: "Dijkweg 3, 2070 Zwijndrecht", lat: 51.2, lon: 4.3 } }, "2026-10-25": { start: "15:00" } },
  carpool: { "2026-10-18": { p1: { role: "rider", with: "p9" }, p9: { role: "driver", seats: 3, note: "vertrek 13:30" } }, "2026-10-25": { p1: { role: "driver", seats: 3 }, p5: { role: "rider", with: "p1" }, p6: { role: "rider", with: "p1" } } } };
const player = { pid: "p1", name: "Levi", avail: { "2026-10-18": "yes", "2026-10-25": "maybe", "2026-11-08": "no" } };
const names = { p9: "Jonas", p5: "Lisa", p6: "Ahmed" };
const ics = buildFeed(team, player, names, { lang: "nl", today: "2026-10-13", now: new Date("2026-10-13T20:00:00Z") });
const un = ics.replace(/\r\n /g, "");
assert(un.startsWith("BEGIN:VCALENDAR\r\n") && un.endsWith("END:VCALENDAR\r\n"));
assert(un.includes("SUMMARY:✅ Zuiderpark · FC Polderzonen"), "yes title");
assert(un.includes("SUMMARY:❔ Zuiderpark · KSV Bosrand"), "maybe title");
assert(un.includes("SUMMARY:❓ Zuiderpark · Racing (finale) · nog antwoorden"), "unanswered title");
assert(un.includes("SUMMARY:❌ Zuiderpark · Nee-match"), "no title");
assert(un.includes("Je rijdt mee met Jonas · vertrek 13:30"), "rider line");
assert(un.includes("Jij rijdt\\, met Lisa en Ahmed · 1 vrije plaats"), "driver line");
assert(un.includes("DTSTART;TZID=Europe/Brussels:20261018T150000") && un.includes("DTEND;TZID=Europe/Brussels:20261018T164500"));
assert(un.includes("DTEND;TZID=Europe/Brussels:20261025T170000"), "end = start + 2h for football");
assert(un.includes("DTSTART;VALUE=DATE:20261101"), "no time: all-day");
assert(!un.includes("Old"), "old matches left out");
assert((un.match(/TRANSP:TRANSPARENT/g) || []).length === 1, "no = free time");
assert(un.includes("STATUS:TENTATIVE"));
const hidden = buildFeed(team, player, names, { lang: "nl", hideNo: true, today: "2026-10-13" });
assert(!hidden.includes("Nee-match"), "hide no");
const fr = buildFeed(team, player, names, { lang: "fr", today: "2026-10-13" }).replace(/\r\n /g, "");
assert(fr.includes("Tu montes avec Jonas") && fr.includes("à répondre"));
assert(ics.split("\r\n").every(l => [...l].length <= 75), "lines folded");
console.log("ics tests ok");
console.log(un.split("\r\n").filter(l => /^(SUMMARY|DESCRIPTION)/.test(l)).slice(0, 4).join("\n"));

// Called off: stays in the feed, marked cancelled
const off = buildFeed({ ...team, schedule: { ...team.schedule, "2026-10-25": { opp: "KSV Bosrand", home: true, cancelled: true } } }, player, names, { lang: "nl", today: "2026-10-13" }).replace(/\r\n /g, "");
assert(off.includes("SUMMARY:❌ Afgelast: Zuiderpark · KSV Bosrand"), "cancelled title");
assert(off.includes("STATUS:CANCELLED"), "cancelled status");
assert((off.match(/TRANSP:TRANSPARENT/g) || []).length === 2, "cancelled = free time");

// The notification for a cancelled / moved match
import { noticeMessage } from "./notice.js";
const tm = { brand: "KFC Zuiderpark", opp: "Racing", start: "15:00" };
const c = noticeMessage("kfc", { k: "c", d: "2026-10-25" }, tm, "K".repeat(22), "nl");
assert.equal(c.body, "❌ Afgelast: Racing op zondag 25 oktober gaat niet door.");
assert(!c.actions && c.link === "https://app.rostiq.be/?t=kfc", "no answer buttons for a cancelled match");
const mv = noticeMessage("kfc", { k: "m", d: "2026-11-01", o: "2026-10-25" }, tm, "K".repeat(22), "fr");
assert.equal(mv.body, "📅 Déplacé : Racing est maintenant le dimanche 1 novembre à 15:00. Tu peux ?");
assert.equal(JSON.parse(mv.links).yes, `https://app.rostiq.be/a/?${"K".repeat(22)}y261101`, "personal answer link");
assert.equal(JSON.parse(mv.actions).length, 3);
const mv2 = noticeMessage("kfc", { k: "m", d: "2026-11-01", o: "2026-10-25" }, { ...tm, start: "", quickLinks: false }, "K".repeat(22), "en");
assert.equal(mv2.body, "📅 Moved: Racing is now on Sunday 1 November. Can you make it?");
assert.equal(JSON.parse(mv2.links).no, "https://app.rostiq.be/?t=kfc&ans=no&d=2026-11-01", "links off: the app");
assert.equal(noticeMessage("kfc", { k: "z", d: "2026-11-01" }, tm, null, "nl"), null);
const sl = noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm, null, "nl", "s");
assert.equal(sl.body, "✅ Je bent geselecteerd voor Racing op zondag 1 november om 15:00.");
assert.equal(noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm, null, "en", "r").body, "🔁 You're a reserve for Racing on Sunday 1 November. We'll let you know if a place opens up.");
assert.equal(noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm, null, "nl", null), null, "not in the selection: nothing");
console.log("notice tests ok");

// Personal reminder (remind.mjs): notification with answer buttons, email with the same three links.
{
  const { remindPush, remindEmail, answerLinks } = await import("./remind.mjs");
  const m = { tid: "kfc", date: "2027-02-01", brand: "KFC", opp: "Racing", start: "14:30", who: "Anna", links: answerLinks("kfc", "2027-02-01", "KEY") };
  const p = remindPush(m, "nl");
  assert.equal(p.title, "KFC");
  assert(p.body.startsWith("Anna vraagt: kan je erbij zijn? Racing, maandag 1 februari om 14:30"), p.body);
  assert.equal(JSON.parse(p.links).yes, "https://app.rostiq.be/a/?KEYy270201");
  assert.deepEqual(JSON.parse(p.actions).map(a => a.action), ["yes", "no", "maybe"]);
  assert(remindPush({ ...m, who: "" }, "en").body.startsWith("Can you make it? Racing"), "no sender name");
  assert(remindPush(m, "xx").body.startsWith("Anna vraagt"), "unknown language falls back to Dutch");
  const e = remindEmail(m, "fr");
  assert(e.subject.startsWith("Tu peux être là ? KFC · Racing"), e.subject);
  for (const k of ["y", "m", "n"]) assert(e.html.includes(`https://app.rostiq.be/a/?KEY${k}270201`) && e.text.includes(`/a/?KEY${k}270201`), "link " + k);
  assert(!remindEmail({ ...m, opp: "<b>x</b>" }, "nl").html.includes("<b>x</b>"), "names are escaped");
  const noKey = answerLinks("kfc", "2027-02-01", null);
  assert.equal(noKey.no, "https://app.rostiq.be/?t=kfc&ans=no&d=2027-02-01");
}
{
  const { profileMissing, profileEmail } = await import("./remind.mjs");
  const st = { fields: { c1: "Rugnummer", c3: "Maat" }, fedLabel: "VHL-nr" };
  assert.deepEqual(profileMissing({}, st, "nl"), ["gsm-nummer", "woonplaats", "Rugnummer", "Maat", "VHL-nr"]);
  assert.deepEqual(profileMissing({ phone: "+32 470", geo: { lat: 1 }, extra: { c1: "7", c3: " " }, fed: "9" }, st, "en"), ["Maat"], "blank counts as missing");
  assert.deepEqual(profileMissing({ phone: "1", gemeente: "Gent" }, { fedOff: true }, "fr"), [], "federation number off");
  assert.deepEqual(profileMissing({}, {}, "fr").slice(0, 2), ["numéro de GSM", "commune"]);
  const em = profileEmail({ tid: "kfc", brand: "KFC", who: "", missing: ["<x>"] }, "en");
  assert(em.subject === "KFC: please complete your details" && em.html.includes("&lt;x&gt;") && em.text.includes("https://app.rostiq.be/ploeg.html?t=kfc#me"));
}
// Line-ups (lineup.js): roles, the selection notification and the calendar line.
{
  const { roleOf, roleText } = await import("./lineup.js");
  const sel = { p: { a: "s", b: "s", c: "s", d: "r", e: "r", f: "s" }, o: { d: 2, e: 1, c: 3 }, pos: { a: "def", b: "bench" }, pair: { f: 1, a: 1 }, cap: "a", pub: true };
  assert.deepEqual(roleOf(sel, "a"), { k: "s", o: null, pos: "def", pair: 1, mate: "f", cap: true });
  assert.equal(roleOf(sel, "zz"), null);
  assert.equal(roleText(roleOf({ p: { a: "s" }, pos: { a: "def" }, cap: "a" }, "a"), "nl"), "Positie: verdediging. Jij bent kapitein.");
  assert.equal(roleText(roleOf(sel, "b"), "en"), "You start on the bench.");
  assert.equal(roleText(roleOf(sel, "c"), "fr"), "Tu joues en numéro 3.");
  assert.equal(roleText(roleOf({ p: { x: "s", y: "s" }, pair: { x: 2, y: 2 } }, "x"), "nl", "Jan"), "Je speelt in paar 2 met Jan.");
  assert.equal(roleText(roleOf(sel, "d"), "nl"), "Je bent reserve 2.");
  const tm2 = { brand: "HC", opp: "Racing", start: "15:00" };
  const r1 = roleOf({ p: { a: "s" }, pos: { a: "mid" } }, "a");
  assert.equal(noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm2, null, "nl", r1).body, "✅ Je bent geselecteerd voor Racing op zondag 1 november om 15:00. Positie: middenveld.");
  assert.equal(noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm2, null, "nl", { ...roleOf(sel, "d") }).body, "🔁 Je bent reserve 2 voor Racing op zondag 1 november. We laten het weten als er een plaats vrijkomt.");
  assert.equal(noticeMessage("kfc", { k: "s", d: "2026-11-01" }, tm2, null, "en", { ...roleOf({ p: { x: "s", y: "s" }, pair: { x: 1, y: 1 } }, "x"), mateName: "Lisa" }).body,
    "✅ You're selected for Racing on Sunday 1 November at 15:00. You play in pair 1 with Lisa.");
  // Calendar: the role in the description once the selection is published
  const feed = buildFeed({ ...team, selection: { "2026-10-25": { p: { p1: "s", p5: "s" }, pair: { p1: 1, p5: 1 }, pub: true }, "2026-10-18": { p: { p1: "s" }, o: { p1: 2 }, pub: false } } },
    player, names, { lang: "nl", today: "2026-10-13", now: new Date("2026-10-13T20:00:00Z") }).replace(/\r\n /g, "");
  assert(feed.includes("📋 Geselecteerd. Je speelt in paar 1 met Lisa."), "pair in the calendar");
  assert(!feed.includes("nummer 2"), "a draft selection stays out of the calendar");
}
console.log("reminder tests passed");
