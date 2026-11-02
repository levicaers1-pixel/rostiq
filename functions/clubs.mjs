// RostiQ Club: a club pays once a season for all its teams: € 6 per active player, at least € 99, at most € 1,500.
// clubs/<cid> = { name, until, teams: { <tid>: true }, admins: { <uid>: true }, at, stats }, made on the RostiQ admin page
// (rostiq.html), which also gives every team of the club billing/<tid> = { plan: "club", until, club: cid, src: "paid" }
// and the people responsible clubAdmins/<uid>/<cid> = true (so the app knows to show them the club page).
// Active: a named player linked to an account who answered at least one match of this season (1 July – until).
// The daily job counts per team into clubs/<cid>/stats: numbers only, no names, so the people responsible learn nothing
// about the players themselves. The season's count is fixed once, from 1 October (stats.count); that's what's billed.
export const CLUB_CENTS = 600, CLUB_MIN = 9900, CLUB_MAX = 150000;
export const clubCents = active => Math.min(CLUB_MAX, Math.max(CLUB_MIN, active * CLUB_CENTS));
export const seasonStart = until => `${Number(until.slice(0, 4)) - 1}-07-01`;
export const countDay = until => `${Number(until.slice(0, 4)) - 1}-10-01`;

/** One team's numbers for the season from..to: players, linked, active, never answered, the next match. */
export function teamStats(team, from, to, today) {
  const linked = new Set(Object.values((team && team.members) || {}));
  const named = Object.entries((team && team.players) || {}).filter(([, p]) => p && p.name);
  const answeredIn = p => Object.keys(p.avail || {}).some(d => d >= from && d <= to);
  const sched = (team && team.schedule) || {};
  const next = Object.keys(sched).filter(d => d >= today && d <= to && sched[d] && sched[d].opp && sched[d].cancelled !== true).sort()[0];
  const info = (team && team.info) || {}, settings = (team && team.settings) || {};
  return {
    name: String(info.brand || "").slice(0, 60), sport: String(settings.sport || "golf").slice(0, 20),
    players: named.length,
    linked: named.filter(([pid]) => linked.has(pid)).length,
    active: named.filter(([pid, p]) => linked.has(pid) && answeredIn(p)).length,
    never: named.filter(([, p]) => !answeredIn(p)).length,
    ...(next ? { next: { date: next, opp: String(sched[next].opp).slice(0, 60), answered: named.filter(([, p]) => (p.avail || {})[next]).length } } : {}),
  };
}

/** The club's stats for today; keeps an earlier fixed count of the same season. */
export function clubStats(club, teams, today, now = Date.now()) {
  const to = club.until, from = seasonStart(to), per = {};
  let active = 0, players = 0;
  for (const tid of Object.keys(club.teams || {})) {
    if (!teams[tid]) continue;
    per[tid] = teamStats(teams[tid], from, to, today);
    active += per[tid].active; players += per[tid].players;
  }
  const kept = club.stats && club.stats.count && club.stats.count.until === to ? club.stats.count : null;
  const count = kept || (today >= countDay(to) ? { at: now, until: to, active, cents: clubCents(active) } : null);
  return { at: now, active, players, cents: clubCents(active), teams: per, ...(count ? { count } : {}) };
}

/** Daily: every club's stats. Returns the database writes. */
export async function runClubs({ db, teams, today, now = Date.now() }) {
  const clubs = (await db.ref("clubs").once("value")).val() || {};
  const writes = {};
  for (const [cid, club] of Object.entries(clubs)) {
    if (!club || typeof club.until !== "string") continue;
    writes[`clubs/${cid}/stats`] = clubStats(club, teams, today, now);
  }
  if (Object.keys(writes).length) console.log(`Clubs: ${Object.keys(writes).length} counted.`);
  return writes;
}

// ---- Club announcements (clubNews/<club>/<id>, the clubNews function in index.js) ----
/** Who gets the club's announcement: every member of every club team once (uid → the first team, for the link), not
 *  the person who posted it. membersByTeam: [[tid, { uid: pid }], …]. */
export function clubNewsTargets(membersByTeam, by) {
  const to = new Map();
  for (const [tid, members] of membersByTeam) for (const uid of Object.keys(members || {})) if (uid !== by && !to.has(uid)) to.set(uid, tid);
  return to;
}
/** The announcement as each team's news item (teams/<t>/news/<id>): shown on the home page, under the club's name. */
export const clubNewsItem = (n, club) => ({ text: String(n.text || "").slice(0, 500), by: String(n.by || ""), name: String(club.name || "").slice(0, 40),
  at: typeof n.at === "number" ? n.at : Date.now(), ...(/^\d{4}-\d{2}-\d{2}$/.test(n.until || "") ? { until: n.until } : {}) });
