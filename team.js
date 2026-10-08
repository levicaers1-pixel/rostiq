// Rostiq: defaults for a team. The chosen team's own settings come from the database
// (teams/{id}/info: brand, logo, colours, season…) and are merged into window.TEAM when it loads.
window.TEAM_DEFAULTS = {
  brand: "Rostiq",        // team / club name
  logo: "",               // light wordmark for the dark header; "" shows the name as text
  shortName: "",          // competition name in chat messages (falls back to the brand)
  calendarLabel: "",      // calendar titles: "{player} {calendarLabel} {opponent}"
  season: "",             // default page title (the team admin can change it)
  adminName: "",          // shown in "ask … to add you" texts (falls back to "the team admin")
  teamSize: 0,            // empty player rows created on a team's first visit
  minPlayers: 3,          // default minimum per match
  colors: null,           // optional: { light: { "--brand": "#…", … }, dark: { … } }
  events: [],             // built-in schedule (normally the schedule lives in the database)
};
window.TEAM = { id: "", ...window.TEAM_DEFAULTS };

// Rostiq owners: create teams and manage every team. Must match tools/build_rules.py.
window.PLATFORM_ADMINS = ["levicaers1@gmail.com"];
