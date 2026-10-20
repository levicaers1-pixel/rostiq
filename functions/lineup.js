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
