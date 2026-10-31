// RostiQ: the golf ranking (Order of Merit with RostiQ Points). The app (index.html) has its own copy of the
// calculation; keep both the same (tests in ics.test.mjs).
// scores/<date> = { f: "stb" | "net" | "gross", p: { <pid>: { s: points or strokes, h: playing handicap } }, at, by }
//   stb: most points wins; net: fewest strokes minus handicap; gross: fewest strokes.
// Each match ranks its players; places earn RostiQ Points (25, 18, 15, 12, 10, 8, 6, 4, 2, 1). A tie: the team's choice
// (settings/tie): the lowest handicap wins (default), or "share" (the tied places' points are shared). Same handicap
// too: shared either way. The season ranking is the sum, ties again by handicap (from the player's profile) or shared.
export const RANK_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const num = x => (typeof x === "number" && isFinite(x) ? x : null);
const round1 = x => Math.round(x * 10) / 10;

/** The result of one match: [{ pid, s, h, v (the score that counts), place, pts }], best first. */
export function matchRanking(score, hcpOf = () => null, tie = "hcp") {
  if (!score || !score.p) return [];
  const f = score.f === "stb" || score.f === "gross" ? score.f : "net";
  const rows = Object.entries(score.p).filter(([, x]) => x && num(x.s) !== null).map(([pid, x]) => {
    const h = num(x.h) !== null ? x.h : num(hcpOf(pid));
    return { pid, s: x.s, h, v: f === "net" ? x.s - (h || 0) : x.s };
  });
  const better = (a, b) => (f === "stb" ? b.v - a.v : a.v - b.v);
  const hcpKey = r => (r.h === null ? 99 : r.h);
  rows.sort((a, b) => better(a, b) || (tie === "share" ? 0 : hcpKey(a) - hcpKey(b)) || a.pid.localeCompare(b.pid));
  const same = (a, b) => better(a, b) === 0 && (tie === "share" || hcpKey(a) === hcpKey(b));
  for (let i = 0; i < rows.length;) {
    let j = i + 1;
    while (j < rows.length && same(rows[i], rows[j])) j++;
    const pts = round1(rows.slice(i, j).reduce((n, _, k) => n + (RANK_POINTS[i + k] || 0), 0) / (j - i));
    for (let k = i; k < j; k++) Object.assign(rows[k], { place: i + 1, pts });
    i = j;
  }
  return rows;
}

/** The season: [{ pid, pts, played, wins, best, form: [last places, newest last], place }], best first. */
export function seasonRanking(scores, hcpOf = () => null, tie = "hcp", until = null) {
  const by = {};
  for (const date of Object.keys(scores || {}).sort()) {
    if (until && date > until) continue;
    for (const r of matchRanking(scores[date], hcpOf, tie)) {
      const x = by[r.pid] || (by[r.pid] = { pid: r.pid, pts: 0, played: 0, wins: 0, best: null, form: [] });
      x.pts = round1(x.pts + r.pts); x.played++;
      if (r.place === 1) x.wins++;
      x.best = x.best === null ? r.place : Math.min(x.best, r.place);
      x.form.push(r.place);
    }
  }
  const hcpKey = pid => (num(hcpOf(pid)) === null ? 99 : hcpOf(pid));
  const list = Object.values(by).sort((a, b) => b.pts - a.pts || (tie === "share" ? 0 : hcpKey(a.pid) - hcpKey(b.pid)) || a.pid.localeCompare(b.pid));
  list.forEach((x, i) => {
    const prev = list[i - 1];
    x.place = prev && prev.pts === x.pts && (tie === "share" || hcpKey(prev.pid) === hcpKey(x.pid)) ? prev.place : i + 1;
    x.form = x.form.slice(-3);
  });
  return list;
}

/** A player's handicap from the team's own fields (the field named handicap / hcp), else null. */
export function profileHcp(player, settings) {
  const c = Object.entries((settings || {}).fields || {}).find(([k, l]) => /^c[1-4]$/.test(k) && /^\s*(handicap|hcp)\s*$/i.test(String(l || "")));
  const v = c && player && player.extra ? parseFloat(String(player.extra[c[0]] || "").replace(",", ".")) : NaN;
  return isFinite(v) ? v : null;
}

const RESULT = {
  nl: (opp, top) => `🏆 Uitslag ${opp} is binnen: ${top}`,
  fr: (opp, top) => `🏆 Le résultat de ${opp} est là : ${top}`,
  en: (opp, top) => `🏆 Result ${opp} is in: ${top}`,
};
/** The notification text: the day's top 3 by first name. */
export function resultText(lang, opp, rows, names) {
  const first = pid => String((names[pid] || {}).name || "?").trim().split(/\s+/)[0];
  const top = rows.slice(0, 3).map(r => `${r.place}. ${first(r.pid)}`).join(", ");
  return (RESULT[lang] || RESULT.nl)(String(opp || "?").slice(0, 60), top);
}
