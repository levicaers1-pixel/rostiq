// "Match called off / moved": the notification every member of the team gets (functions/index.js sends it).
// notice = { k: "c" (cancelled) | "m" (moved), d: the match's date (for a move: the new one), o: the old date }.
// A move asks again whether you can come, with answer buttons (personal link when the player has one).
const APP = "https://app.rostiq.be";
const LOCALES = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" };
const TEXT = {
  nl: { c: (opp, when) => `❌ Afgelast: ${opp} op ${when} gaat niet door.`,
        m: (opp, when, at) => `📅 Verplaatst: ${opp} is nu op ${when}${at ? ` om ${at}` : ""}. Kan je dan?` },
  fr: { c: (opp, when) => `❌ Annulé : le match contre ${opp} du ${when} n'aura pas lieu.`,
        m: (opp, when, at) => `📅 Déplacé : ${opp} est maintenant le ${when}${at ? ` à ${at}` : ""}. Tu peux ?` },
  en: { c: (opp, when) => `❌ Called off: ${opp} on ${when} is not going ahead.`,
        m: (opp, when, at) => `📅 Moved: ${opp} is now on ${when}${at ? ` at ${at}` : ""}. Can you make it?` },
};
const ACTIONS = {
  nl: [["yes", "✅ Ja"], ["no", "❌ Nee"], ["maybe", "❓ Misschien"]],
  fr: [["yes", "✅ Oui"], ["no", "❌ Non"], ["maybe", "❓ Peut-être"]],
  en: [["yes", "✅ Yes"], ["no", "❌ No"], ["maybe", "❓ Maybe"]],
};
const isDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const whenText = (date, lang) => new Date(date + "T12:00:00Z").toLocaleDateString(LOCALES[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const yymmdd = date => date.slice(2).replace(/-/g, "");

// team: { brand, opp, start, quickLinks }, key: the player's personal answer key (or null), lang: the device's language.
// Returns the data message for one device, or null when the notice makes no sense.
export function noticeMessage(tid, notice, team, key, lang) {
  if (!notice || !isDate(notice.d) || (notice.k !== "c" && notice.k !== "m")) return null;
  const L = TEXT[lang] ? lang : "nl", opp = String(team.opp || "?").slice(0, 60), date = notice.d;
  const app = `${APP}/?t=${encodeURIComponent(tid)}`;
  const data = { title: String(team.brand || "RostiQ").slice(0, 60), tag: `${tid}-${notice.k}-${date}`, link: app };
  if (notice.k === "c") return { ...data, body: TEXT[L].c(opp, whenText(date, L)) };
  const links = key && team.quickLinks !== false
    ? { open: `${APP}/a/?${key}q${yymmdd(date)}`, yes: `${APP}/a/?${key}y${yymmdd(date)}`, maybe: `${APP}/a/?${key}m${yymmdd(date)}`, no: `${APP}/a/?${key}n${yymmdd(date)}` }
    : { open: app, yes: `${app}&ans=yes&d=${date}`, maybe: `${app}&ans=maybe&d=${date}`, no: `${app}&ans=no&d=${date}` };
  return { ...data, body: TEXT[L].m(opp, whenText(date, L), /^\d\d:\d\d$/.test(team.start || "") ? team.start : ""), link: links.open,
    links: JSON.stringify({ yes: links.yes, maybe: links.maybe, no: links.no }),
    actions: JSON.stringify(ACTIONS[L].map(([action, title]) => ({ action, title }))) };
}
