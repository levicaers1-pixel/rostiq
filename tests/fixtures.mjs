// Test data for the smoke test: two teams and one signed-in user (dates relative to today, so they never go stale).
// - "fresh": a new golf team: the user's player has never answered (no "avail" at all), selections off, no match
//   details yet. This is the situation that crashed Home for the first pilot team.
// - "full": a hockey team in use: answers, match details, carpool, a published selection, an announcement, trainings.
// The user (tester@rostiq.test) is a player and admin in both.
export const USER = { uid: "u-tester", email: "tester@rostiq.test", displayName: "Test Tester" };
export const QUICK_KEY = "TestKeyTestKeyTestKey1"; // 22 characters: a personal answer link for "full" / p2

const day = (n, today = new Date()) => new Date(today.getTime() + n * 864e5).toLocaleDateString("sv-SE");

export function seed(today = new Date()) {
  const d = n => day(n, today);
  const fresh = {
    initialized: true,
    info: { brand: "Fresh Golf Club Long Name Winter League", shortName: "Fresh Golf", minPlayers: 4 },
    settings: { sport: "golf", minPlayers: 4, scheduleInDb: true, seasonName: "Fresh Winter League", selOff: true },
    schedule: { [d(9)]: { opp: "Midden-Brabant", home: false }, [d(40)]: { opp: "Het Woold", home: false }, [d(80)]: { opp: "Golf du Château", home: false, final: true } },
    players: {
      p1: { name: "Test Tester", uid: USER.uid, order: 1, gemeente: "Berchem" },
      p2: { name: "Jonas Example", uid: "u-other", order: 2 },
    },
    members: { [USER.uid]: "p1", "u-other": "p2" },
    admins: { [USER.uid]: true },
  };
  const players = {};
  const names = ["Test Tester", "Julie Willems", "Louise Dubois", "Lotte Smets", "Nora Maes", "Sara Goossens"];
  names.forEach((name, i) => {
    const id = "p" + (i + 1);
    players[id] = { name, order: i + 1, gemeente: ["Berchem", "Schoten", "Mechelen", "Edegem", "Wommelgem", "Lier"][i],
      ...(i < 4 ? { uid: i === 0 ? USER.uid : "u-" + id } : {}),
      avail: { [d(5)]: i < 4 ? "yes" : i === 4 ? "maybe" : "no", [d(12)]: i % 2 ? "yes" : "maybe" },
      extra: { c1: String(i + 4) } };
  });
  const full = {
    initialized: true,
    info: { brand: "HC Test", shortName: "HC Test", minPlayers: 4 },
    settings: { sport: "hockey", minPlayers: 4, scheduleInDb: true, seasonName: "HC Test · Dames 1", fields: { c1: "Rugnummer" },
      train: { slots: { t1: { wd: 3, start: "20:00", end: "21:30" } }, from: d(-30), to: d(120) } },
    schedule: { [d(-7)]: { opp: "Past Club", home: true }, [d(5)]: { opp: "Polo Kastanje", home: false }, [d(12)]: { opp: "Dragons Oost", home: true }, [d(26)]: { opp: "HC Waterkant", home: false } },
    matches: { [d(5)]: { start: "12:30", end: "14:00", meet: "11:45 clubhuis", venue: { name: "Kastanjepark", address: "Kastanjepark, 2900 Schoten", lat: 51.25, lon: 4.5 } } },
    players,
    members: { [USER.uid]: "p1", "u-p2": "p2", "u-p3": "p3", "u-p4": "p4" },
    admins: { [USER.uid]: true },
    carpool: { [d(5)]: { p2: { role: "driver", seats: 3 }, p1: { role: "rider", with: "p2" }, p3: { role: "rider" } } },
    selection: { [d(5)]: { p: { p1: "s", p2: "s", p3: "s", p4: "s", p5: "r" }, pub: true, at: Date.now() } },
    news: { n1: { text: "Teamfoto zondag om 10u. Witte shirts!", name: "Test", by: USER.uid, at: Date.now() - 3600e3, until: d(10) } },
  };
  // "golf": a golf team with two results (Stableford, then strokeplay net with a tie at 72 that the lower handicap wins).
  // Expected ranking: Test Tester 43 (hcp 4.2) and Jonas 43 (hcp 9.8): the lower handicap first; Jens 30; Arnaud 24.
  const golf = {
    initialized: true,
    info: { brand: "Golf Ranking Club", shortName: "GRC", minPlayers: 4 },
    settings: { sport: "golf", minPlayers: 4, scheduleInDb: true, seasonName: "GRC Winter", fields: { c1: "Handicap" } },
    schedule: { [d(-20)]: { opp: "Midden-Brabant" }, [d(-6)]: { opp: "Het Woold" }, [d(15)]: { opp: "Haviksoord" } },
    players: {
      p1: { name: "Test Tester", uid: USER.uid, order: 1, extra: { c1: "4,2" }, avail: { [d(-20)]: "yes", [d(-6)]: "yes" } },
      p2: { name: "Jonas Maselis", order: 2, extra: { c1: "9.8" }, avail: { [d(-20)]: "yes", [d(-6)]: "yes" } },
      p3: { name: "Jens Havermaet", order: 3, extra: { c1: "14" }, avail: { [d(-20)]: "yes", [d(-6)]: "yes" } },
      p4: { name: "Arnaud Gruwez", order: 4, extra: { c1: "15" }, avail: { [d(-20)]: "yes", [d(-6)]: "yes" } },
    },
    members: { [USER.uid]: "p1" },
    admins: { [USER.uid]: true },
    scores: {
      [d(-20)]: { f: "stb", p: { p1: { s: 36, h: 4 }, p2: { s: 33, h: 10 }, p3: { s: 31, h: 14 }, p4: { s: 29, h: 15 } }, at: 1, by: USER.uid },
      [d(-6)]: { f: "net", p: { p1: { s: 76, h: 4 }, p2: { s: 81, h: 10 }, p3: { s: 86, h: 14 }, p4: { s: 90, h: 15 } }, at: 2, by: USER.uid },
      // A result left behind by a match that was removed from the schedule: it must not count (Arnaud would win it).
      [d(-30)]: { f: "stb", p: { p4: { s: 45, h: 15 } }, at: 0, by: USER.uid },
    },
  };
  return {
    teams: { fresh, full, golf },
    users: { [USER.uid]: { teams: { fresh: "p1", full: "p1", golf: "p1" }, profile: { gemeente: "Berchem" } } },
    quickKeys: { [QUICK_KEY]: { t: "full", p: "p2", at: Date.now() } },
    quickIndex: { full: { p2: QUICK_KEY } },
  };
}
