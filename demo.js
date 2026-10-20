// RostiQ: demo teams (app.rostiq.be/?demo=football | padel | hockey).
// buildDemo() makes a complete, fictional team with match dates relative to today, so a demo never looks
// outdated. Nothing here touches the database: common.js keeps the visitor's changes in this tab only.
(function () {
  // Small deterministic random generator: the same demo looks the same on every visit.
  const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
  const nextWeekday = (iso, wd) => { const d = new Date(iso + "T12:00:00"); let n = (wd - d.getDay() + 7) % 7; if (n < 2) n += 7; return addDays(iso, n); };

  // Real towns (so carpool distances and driving times work), fictional clubs and people.
  const TOWNS = [
    ["Berchem", 51.194, 4.433], ["Mortsel", 51.17, 4.456], ["Edegem", 51.155, 4.443], ["Wilrijk", 51.168, 4.394],
    ["Hove", 51.153, 4.468], ["Kontich", 51.134, 4.446], ["Boechout", 51.16, 4.497], ["Wommelgem", 51.204, 4.523],
    ["Schoten", 51.252, 4.501], ["Brasschaat", 51.291, 4.492], ["Kapellen", 51.313, 4.433], ["Hemiksem", 51.144, 4.339],
    ["Lier", 51.131, 4.57], ["Mechelen", 51.026, 4.478], ["Deurne", 51.215, 4.462], ["Ekeren", 51.281, 4.418],
  ];
  // Texts inside the demo data, in the visitor's language.
  const LT = {
    nl: { member: "Lidnummer", number: "Rugnummer", position: "Positie", side: "Kant", left: "Links", right: "Rechts", keeper: "Keeper",
      foot: ["Verdediger", "Middenvelder", "Aanvaller"], hockey: ["Verdediging", "Middenveld", "Aanval"], ranking: "Padel-ranking", kbhb: "KBHB-lidnummer",
      meetFoot: "13:45 aan de kantine", meetHockey: "11:15 in het clubhuis", meetGolf: "08:15 aan de driving range", hcp: "Handicap", ic2: "Interclub Heren", info: "Witte shirts meebrengen", infoPadel: "Nieuwe ballen meebrengen", infoGolf: "Clubpolo dragen aub", leave: "vertrek", d2: "2e Provinciale", ic: "Interclub Heren", w1: "Dames 1" },
    fr: { member: "N° de membre", number: "Numéro de maillot", position: "Poste", side: "Côté", left: "Gauche", right: "Droite", keeper: "Gardien",
      foot: ["Défenseur", "Milieu", "Attaquant"], hockey: ["Défense", "Milieu", "Attaque"], ranking: "Classement padel", kbhb: "N° ARBH",
      meetFoot: "13:45 à la buvette", meetHockey: "11:15 au club-house", meetGolf: "08:15 au practice", hcp: "Handicap", ic2: "Interclub Messieurs", info: "Prendre les maillots blancs", infoPadel: "Apporter des balles neuves", infoGolf: "Polo du club svp", leave: "départ", d2: "2e Provinciale", ic: "Interclub Messieurs", w1: "Dames 1" },
    en: { member: "Member no.", number: "Shirt number", position: "Position", side: "Side", left: "Left", right: "Right", keeper: "Goalkeeper",
      foot: ["Defender", "Midfielder", "Forward"], hockey: ["Defence", "Midfield", "Attack"], ranking: "Padel ranking", kbhb: "Federation no.",
      meetFoot: "13:45 at the clubhouse", meetHockey: "11:15 at the clubhouse", meetGolf: "08:15 at the driving range", hcp: "Handicap", ic2: "Men's interclub", info: "Bring the white shirts", infoPadel: "Bring new balls", infoGolf: "Club polo please", leave: "leaving", d2: "2nd Provincial", ic: "Men's interclub", w1: "Women 1" },
  };
  const L = LT[typeof LANG === "string" && LT[LANG] ? LANG : "nl"];
  const FIRST = ["Lucas", "Noah", "Arthur", "Louis", "Jules", "Victor", "Finn", "Mats", "Wout", "Senne", "Robbe", "Lars", "Milan", "Kobe", "Thibo", "Jasper", "Emma", "Olivia", "Louise", "Mila", "Nora", "Lena", "Fien", "Julie", "Hanne", "Lotte", "Marie", "Sara"];
  const LAST = ["Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "De Smet", "Dubois", "Lambert", "Van Damme", "Hermans", "Aerts", "Smets", "Verbeke", "Michiels"];

  const SPEC = {
    football: {
      brand: "KFC Zuiderpark", short: "Zuiderpark", season: "Zuiderpark · " + L.d2, sport: "football",
      colors: ["#14532d", "#facc15"], players: 17, min: 11, women: false, weekday: 0, start: "15:00", end: "16:45", meet: L.meetFoot,
      fedLabel: L.member, fields: { c1: L.number, c2: L.position },
      extra: i => ({ c1: String(i === 0 ? 8 : i + 1), c2: i === 1 ? L.keeper : L.foot[i % 3] }),
      home: { name: "Sportpark Zuiderpark", address: "Sportlaan 1, 2610 Wilrijk", lat: 51.163, lon: 4.389 },
      opps: [["VV Dorpsveld", "Hoofdveld VV Dorpsveld", "Kerkstraat 12, 2560 Nijlen", 51.161, 4.67], ["SK Heidebloem", "Terrein De Heide", "Heidestraat 5, 2980 Zoersel", 51.268, 4.713],
        ["FC Polderzonen", "Polderstadion", "Dijkweg 3, 2070 Zwijndrecht", 51.218, 4.329], ["KSV Bosrand", "Sportcentrum Bosrand", "Bosweg 9, 2900 Schoten", 51.259, 4.512],
        ["Racing Molenhoek", "Molenhoek Arena", "Molenstraat 22, 2500 Lier", 51.139, 4.552], ["FC Rivierstad", "Complex De Rivier", "Kaai 4, 2800 Mechelen", 51.031, 4.488]],
    },
    padel: {
      brand: "Smash & Co", short: "Smash & Co", season: "Smash & Co · " + L.ic, sport: "padel",
      colors: ["#0c4a6e", "#a3e635"], players: 7, min: 4, women: false, weekday: 6, start: "10:00", end: "12:00", meet: "",
      fedLabel: L.ranking, fields: { c1: L.side }, extra: i => ({ c1: i % 2 ? L.left : L.right }),
      home: { name: "Padel Club Zuid", address: "Padelstraat 3, 2640 Mortsel", lat: 51.171, lon: 4.462 },
      opps: [["Vibora Padel", "Vibora Padel Center", "Industrieweg 8, 2280 Grobbendonk", 51.192, 4.735], ["Bandeja Boys", "Padel Arena Noord", "Noorderlaan 40, 2030 Antwerpen", 51.252, 4.411],
        ["Chiquita Club", "Club Chiquita", "Stationsstraat 2, 2550 Kontich", 51.133, 4.447], ["Por Tres", "Por Tres Padel", "Liersesteenweg 99, 2800 Mechelen", 51.04, 4.5],
        ["Golpe Fuerte", "Golpe Fuerte Indoor", "Ringlaan 7, 2960 Brecht", 51.351, 4.639], ["Pared Amigos", "Padel Pared", "Vaartstraat 15, 2520 Ranst", 51.19, 4.56]],
    },
    golf: {
      brand: "Golfclub De Linde", short: "De Linde", season: "De Linde · " + L.ic2, sport: "golf",
      colors: ["#1f3a2e", "#cdb994"], players: 9, min: 4, women: false, weekday: 6, start: "09:00", end: "17:00", meet: L.meetGolf,
      fedLabel: L.member, fields: { c1: L.hcp }, extra: i => ({ c1: (4 + ((i * 37) % 160) / 10).toFixed(1) }),
      home: { name: "Golfclub De Linde", address: "Lindendreef 1, 2970 Schilde", lat: 51.239, lon: 4.589 },
      opps: [["Royal Heideveld", "Golf Heideveld", "Heideweg 20, 2400 Mol", 51.19, 5.116], ["GC Kempenduin", "Kempenduin Golf", "Duinweg 4, 2460 Kasterlee", 51.24, 4.966],
        ["Bosrijk Golf", "Golf Bosrijk", "Boslaan 11, 3150 Haacht", 50.977, 4.638], ["GC Polderwind", "Polderwind Links", "Polderdijk 2, 9130 Beveren", 51.278, 4.24],
        ["Royal Kasteelhof", "Kasteelhof Golf", "Kasteeldreef 1, 3080 Tervuren", 50.823, 4.514], ["GC Vennenhof", "Golf Vennenhof", "Vennestraat 9, 2490 Balen", 51.17, 5.17]],
    },
    hockey: {
      brand: "HC Scheldevallei", short: "Scheldevallei D1", season: "Scheldevallei · " + L.w1, sport: "hockey",
      colors: ["#7f1d1d", "#fbbf24"], players: 16, min: 11, women: true, weekday: 0, start: "12:30", end: "14:00", meet: L.meetHockey,
      fedLabel: L.kbhb, fields: { c1: L.number, c2: L.position },
      extra: i => ({ c1: String(i + 4), c2: i === 1 ? L.keeper : L.hockey[i % 3] }),
      home: { name: "Hockeyveld Scheldevallei", address: "Scheldelaan 10, 2660 Hoboken", lat: 51.175, lon: 4.346 },
      opps: [["Royal Lindenhof HC", "Lindenhof Kunstgras", "Lindenlaan 1, 2650 Edegem", 51.148, 4.428], ["Hockey Duinenrand", "Duinenrand Velden", "Duinstraat 30, 2970 Schilde", 51.244, 4.588],
        ["Polo Kastanje", "Kastanjepark", "Parklaan 6, 2900 Schoten", 51.256, 4.48], ["Dragons Oost", "Sportpark Oost", "Ooststraat 17, 2100 Deurne", 51.218, 4.482],
        ["HC Waterkant", "Waterkant Hockey", "Havenweg 2, 2030 Antwerpen", 51.265, 4.398], ["Mosselhof HC", "Mosselhof", "Zeelaan 4, 2850 Boom", 51.09, 4.37]],
    },
  };

  window.DEMO_KINDS = Object.keys(SPEC);

  window.buildDemo = function (kind, today) {
    const S = SPEC[kind], r = rng(kind.length * 7919 + 17);
    const youName = { nl: "Jij (demo)", fr: "Toi (démo)", en: "You (demo)" }[typeof LANG === "string" ? LANG : "nl"] || "Jij (demo)";
    // Matches: two in the past, the next one soon, and three more.
    const first = nextWeekday(today, S.weekday);
    const dates = [-21, -14, 0, 7, 14, 21].map(n => addDays(first, n)); // the first is 2–8 days away, so the two past ones are before today

    // Players
    const players = {}, members = { demo: "p1" }, ids = [];
    const firsts = S.women ? FIRST.slice(16) : FIRST.slice(0, 16);
    for (let i = 0; i < S.players; i++) {
      const id = "p" + (i + 1), town = TOWNS[(i * 5 + 3) % TOWNS.length];
      const name = i === 0 ? youName : `${firsts[(i * 7) % firsts.length]} ${LAST[(i * 5) % LAST.length]}`;
      players[id] = {
        order: i + 1, name, gemeente: town[0], geo: { label: `${town[0]} (Antwerpen)`, lat: town[1], lon: town[2] },
        ...(i === 0 ? { phone: "32470000000", email: "demo@rostiq.be" } : i % 4 === 1 ? {} : { email: `${name.split(" ")[0].toLowerCase()}@example.com` }),
        // Padel: the "federation number" field is the padel ranking (P-level); the other sports: a member number.
        ...(S.sport === "padel" ? { fed: "P" + [500, 300, 300, 200, 200, 100, 100][i % 7] } : i % 3 ? { fed: String(100000 + Math.floor(r() * 899999)) } : {}),
        extra: S.extra(i), avail: {},
      };
      if (i < S.players - 2) { players[id].uid = i === 0 ? "demo" : "d" + i; if (i) members["d" + i] = id; } // two not linked yet
      ids.push(id);
    }

    // Answers: the past ones complete, the next one almost (a few still to answer), later ones partly.
    const fill = (date, answered, yesShare) => ids.forEach((id, i) => {
      if (i === 0) return; // "you" decide yourself
      if (r() > answered) return;
      const x = r();
      players[id].avail[date] = x < yesShare ? "yes" : x < yesShare + .15 ? "maybe" : "no";
    });
    fill(dates[0], 1, .78); fill(dates[1], 1, .74); fill(dates[2], .8, .8); fill(dates[3], .55, .7); fill(dates[4], .3, .7);
    players.p1.avail[dates[0]] = "yes"; players.p1.avail[dates[1]] = "maybe";

    // Schedule and match details
    const schedule = {}, matches = {};
    dates.forEach((date, i) => {
      const o = S.opps[i % S.opps.length], home = i % 2 === 1;
      schedule[date] = { opp: o[0], home, ...(i === 5 ? { final: true } : {}) };
      const venue = home ? S.home : { name: o[1], address: o[2], lat: o[3], lon: o[4] };
      matches[date] = { start: S.start, end: S.end, venue, ...(S.meet && !home ? { meet: S.meet } : {}) };
    });
    matches[dates[2]].info = { padel: L.infoPadel, golf: L.infoGolf }[kind] || L.info;

    // Carpools: the past away match and the next one.
    const away = dates.filter(d => !schedule[d].home && d >= dates[0]);
    const carpool = {};
    const plan = (date, seatsPerCar) => {
      const yes = ids.filter(id => players[id].avail[date] === "yes" && id !== "p1");
      const c = carpool[date] = {};
      // The 2nd and 5th player who said yes drive.
      seatsPerCar.forEach((seats, n) => { const d = yes[n * 3 + 1]; if (d) c[d] = { role: "driver", seats, note: S.meet ? S.meet.split(" ")[0] + " " + L.leave : "" }; });
      const ds = Object.keys(c);
      let k = 0;
      yes.filter(id => !c[id]).forEach((id, n) => {
        if (n % 4 === 3) { c[id] = { role: "rider" }; return; } // still waiting for a car
        const d = ds[k % ds.length];
        if (!d) return;
        const taken = Object.values(c).filter(x => x.with === d).length;
        if (taken < c[d].seats) { c[id] = { role: "rider", with: d }; } else { k++; }
      });
    };
    if (away[0]) plan(away[0], [3, 4]);
    if (away[1]) plan(away[1], [4, 3]);

    const now = Date.now();
    return {
      team: {
        info: { brand: S.brand, shortName: S.short, calendarLabel: S.short, adminName: youName, colors: makePalette(...S.colors) },
        initialized: true,
        settings: { minPlayers: S.min, seasonName: S.season, scheduleInDb: true, sport: S.sport, fedLabel: S.fedLabel, fields: S.fields },
        admins: { demo: true }, members, players, schedule, matches, carpool,
        requests: { dnew: { name: S.women ? "Ines Vermeulen" : "Sam Vermeulen", email: "nieuw@example.com", at: now - 3 * 3600e3 } },
      },
      // What the admin page reads outside the team (only admins see it in the real app).
      lastSeen: Object.fromEntries(Object.entries(members).map(([uid], i) => [uid, now - [5, 50, 200, 900, 2600, 6000, 20000, 90000, 300000][i % 9] * 60e3])),
    };
  };
})();
