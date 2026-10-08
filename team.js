// Team-specific settings. Everything that belongs to one team (name, logo, admins, schedule…)
// lives here; the rest of the code is shared. Other teams get their own copy of this file,
// generated from teams/<id>/team.json by tools/build_team.py.
window.TEAM = {
  id: "pampas-wintermidam",
  brand: "Pampas",                      // team / club name (page titles, link previews)
  logo: "assets/wordmark-light.png",    // light wordmark for the dark header; "" shows the brand as text
  shortName: "Winter Midam",            // competition name in chat messages
  calendarLabel: "Wintermidam",         // calendar titles: "{player} Wintermidam {location}"
  season: "Winter Midam 26-27",         // default page title (the admin can change it on the Admin tab)
  admins: ["levicaers1@gmail.com"],     // admin login emails (must match the database rules)
  adminName: "Levi",                    // shown in "ask Levi…" texts
  teamSize: 15,                         // empty player rows created on the very first visit
  minPlayers: 3,                        // default minimum per match (changeable on the Admin tab)
  colors: null,                         // optional: { light: { "--brand": "#…", … }, dark: { … } }
  // Built-in schedule, used until the admin edits matches on the Admin tab.
  events: [
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
  ],
};
