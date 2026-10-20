// RostiQ: a player's place in a match selection, and how to say it (notification, calendar).
// selection/<date> = { p: { <pid>: "s" | "r" }, o: { <pid>: n } (playing order, or reserve order),
//   pos: { <pid>: "gk" | "def" | "mid" | "fwd" | "bench" } (squad sports), pair: { <pid>: n } (padel/doubles), cap: <pid>, pub, at }.
// The app (index.html) builds it; its own copy of these texts is in i18n (sel.role.*).

/** This player's place: null (not in it), or { k: "s" | "r", o, pos, pair, mate, cap }. */
export function roleOf(sel, pid) {
  const k = ((sel && sel.p) || {})[pid];
  if (k !== "s" && k !== "r") return null;
  const o = Number(((sel.o || {})[pid])) || null, pair = Number(((sel.pair || {})[pid])) || null;
  const mate = k === "s" && pair ? Object.keys(sel.pair || {}).find(id => id !== pid && Number(sel.pair[id]) === pair && (sel.p || {})[id] === "s") || null : null;
  return { k, o, pos: k === "s" ? (sel.pos || {})[pid] || null : null, pair: k === "s" ? pair : null, mate, cap: k === "s" && sel.cap === pid };
}

const POS = {
  nl: { gk: "doel", def: "verdediging", mid: "middenveld", fwd: "aanval" },
  fr: { gk: "gardien", def: "défense", mid: "milieu", fwd: "attaque" },
  en: { gk: "goal", def: "defence", mid: "midfield", fwd: "attack" },
};
const TEXT = {
  nl: { pos: p => `Positie: ${p}.`, bench: "Je start op de bank.", order: n => `Je speelt als nummer ${n}.`,
        pair: (n, m) => `Je speelt in paar ${n}${m ? ` met ${m}` : ""}.`, cap: "Jij bent kapitein.", reserve: n => n ? `Je bent reserve ${n}.` : "Je bent reserve." },
  fr: { pos: p => `Poste : ${p}.`, bench: "Tu commences sur le banc.", order: n => `Tu joues en numéro ${n}.`,
        pair: (n, m) => `Tu joues dans la paire ${n}${m ? ` avec ${m}` : ""}.`, cap: "Tu es capitaine.", reserve: n => n ? `Tu es réserve ${n}.` : "Tu es réserve." },
  en: { pos: p => `Position: ${p}.`, bench: "You start on the bench.", order: n => `You play as number ${n}.`,
        pair: (n, m) => `You play in pair ${n}${m ? ` with ${m}` : ""}.`, cap: "You're captain.", reserve: n => n ? `You're reserve ${n}.` : "You're a reserve." },
};
/** One short sentence (or more) about the role; "" when there's nothing to add to "you're selected". mateName: first name. */
export function roleText(role, lang, mateName) {
  if (!role) return "";
  const L = TEXT[lang] ? lang : "nl", T = TEXT[L];
  if (role.k === "r") return T.reserve(role.o);
  const bits = [];
  if (role.pos === "bench") bits.push(T.bench);
  else if (POS[L][role.pos]) bits.push(T.pos(POS[L][role.pos]));
  if (role.pair) bits.push(T.pair(role.pair, mateName));
  else if (role.o) bits.push(T.order(role.o));
  if (role.cap) bits.push(T.cap);
  return bits.join(" ");
}

// ---- A selected player drops out: reserve 1 takes their exact place (position, number or pair) ----
/** Returns { sel: the new selection, in: the reserve who comes in (or null) } for player pid leaving; null when pid wasn't
 *  selected. Reserves move up (reserve 2 becomes reserve 1); a captain who drops out leaves the team without one. */
export function promoteReserve(sel, pid, at = Date.now()) {
  if (!sel || !sel.p || sel.p[pid] !== "s") return null;
  const next = JSON.parse(JSON.stringify(sel)), o = next.o || {};
  const reserves = Object.keys(next.p).filter(id => next.p[id] === "r").sort((a, b) => (Number(o[a]) || 99) - (Number(o[b]) || 99));
  const sub = reserves[0] || null;
  if (sub) {
    next.p[sub] = "s";
    for (const k of ["pos", "pair"]) if (next[k] && next[k][pid] != null) next[k][sub] = next[k][pid];
    if (o[pid] != null) o[sub] = o[pid]; else delete o[sub]; // the playing number (order format), not the reserve number
  }
  delete next.p[pid];
  for (const k of ["o", "pos", "pair"]) if (next[k]) delete next[k][pid];
  if (next.cap === pid) delete next.cap;
  reserves.slice(1).forEach((id, i) => { o[id] = i + 1; });
  next.o = o;
  for (const k of ["o", "pos", "pair"]) if (next[k] && !Object.keys(next[k]).length) delete next[k];
  next.chg = { out: pid, ...(sub ? { in: sub } : {}), at };
  return { sel: next, in: sub };
}

const SUB = {
  nl: { in: (out, opp, when) => `✅ ${out} kan niet meer: jij speelt nu mee tegen ${opp} op ${when}.`,
        admin: (out, sub, opp) => sub ? `🔁 ${out} kan niet meer voor ${opp}. ${sub} (reserve) valt in.` : `⚠️ ${out} kan niet meer voor ${opp}, en er is geen reserve meer. Zoek een vervanger.`,
        ride: (out, opp) => `🚗 ${out} rijdt niet meer naar ${opp}. Zoek een nieuwe lift in RostiQ.`,
        manual: (out, opp) => `⚠️ ${out} kan niet meer voor ${opp}. Kies een vervanger in de selectie.` },
  fr: { in: (out, opp, when) => `✅ ${out} ne peut plus : tu joues maintenant contre ${opp} le ${when}.`,
        admin: (out, sub, opp) => sub ? `🔁 ${out} ne peut plus pour ${opp}. ${sub} (réserve) le remplace.` : `⚠️ ${out} ne peut plus pour ${opp}, et il n'y a plus de réserve. Trouve un remplaçant.`,
        ride: (out, opp) => `🚗 ${out} ne conduit plus vers ${opp}. Cherche un nouveau trajet dans RostiQ.`,
        manual: (out, opp) => `⚠️ ${out} ne peut plus pour ${opp}. Choisis un remplaçant dans la sélection.` },
  en: { in: (out, opp, when) => `✅ ${out} can't make it: you're now playing against ${opp} on ${when}.`,
        admin: (out, sub, opp) => sub ? `🔁 ${out} can't make it to ${opp}. ${sub} (reserve) steps in.` : `⚠️ ${out} can't make it to ${opp}, and there's no reserve left. Find a replacement.`,
        ride: (out, opp) => `🚗 ${out} is no longer driving to ${opp}. Find a new lift in RostiQ.`,
        manual: (out, opp) => `⚠️ ${out} can't make it to ${opp}. Pick a replacement in the selection.` },
};
/** Texts for the dropout chain: kind "in" (the reserve), "admin", "manual" (admins, automatic replacement off), "ride". */
export function subText(kind, lang, v) {
  const T = SUB[SUB[lang] ? lang : "nl"];
  return kind === "in" ? T.in(v.out, v.opp, v.when) : kind === "admin" ? T.admin(v.out, v.sub, v.opp) : kind === "manual" ? T.manual(v.out, v.opp) : T.ride(v.out, v.opp);
}
