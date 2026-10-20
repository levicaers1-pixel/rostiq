// RostiQ: weekly trainings. settings/train = { slots: { <id>: { wd (0 = Sunday … 6), start, end, venue } }, from, to,
// optOut }; trainings/<date> = { off: true (called off), note }; answers in players/<pid>/tr/<date> = "yes" | "no".
// The app (index.html, common.js) has its own copy of trainingDates.

const iso = d => d.toISOString().slice(0, 10);
/** The trainings between two dates (inclusive), in order: [{ date, id, wd, start, end, venue, off, note }]. */
export function trainingDates(train, overrides, from, to) {
  if (!train || !train.slots) return [];
  const slots = Object.entries(train.slots).filter(([, s]) => s && typeof s.wd === "number" && s.start);
  const a = train.from && train.from > from ? train.from : from, b = train.to && train.to < to ? train.to : to;
  const out = [];
  for (let d = new Date(a + "T12:00:00Z"), n = 0; iso(d) <= b && n < 400; d = new Date(d.getTime() + 864e5), n++) {
    for (const [id, s] of slots) if (s.wd === d.getUTCDay()) {
      const o = (overrides || {})[iso(d)] || {};
      out.push({ date: iso(d), id, wd: s.wd, start: s.start, end: s.end || "", venue: s.venue || null, off: o.off === true, note: o.note || "" });
    }
  }
  return out;
}
/** Coming? With optOut everyone counts unless they said no. */
export const trainComing = (train, answer) => answer === "yes" || (!!(train && train.optOut) && answer !== "no");

const TEXT = {
  nl: { off: (when, note) => `❌ De training van ${when} gaat niet door.${note ? ` ${note}` : ""}`, title: "Training" },
  fr: { off: (when, note) => `❌ L'entraînement du ${when} n'a pas lieu.${note ? ` ${note}` : ""}`, title: "Entraînement" },
  en: { off: (when, note) => `❌ Training on ${when} is off.${note ? ` ${note}` : ""}`, title: "Training" },
};
const LOCALES = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" };
export const trainWhen = (date, lang) => new Date(date + "T12:00:00Z").toLocaleDateString(LOCALES[lang] || "nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const trainText = (kind, lang, v) => { const T = TEXT[TEXT[lang] ? lang : "nl"]; return kind === "off" ? T.off(trainWhen(v.date, lang), v.note) : T.title; };
