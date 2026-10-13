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
