// RostiQ plans: Free, Pro and Club. The app (common.js) has its own copy; keep both the same (tests in ics.test.mjs).
// billing/<team> = { plan: "pro" | "club", until: "YYYY-MM-DD" (last day, inclusive), src: "pilot" | "paid" | "gift",
//                    trial: <ms> (end of the 30-day trial; a team admin may start it once) }
// Written by the RostiQ admin (and later the payment webhook); members read it. No billing, or an ended plan: Free.
// Pro features are hidden on Free, never deleted: switching back brings everything back.
// PLANS_ON false: every team counts as Pro, as before the plans start. Switch together with window.PLANS_ON (config.js).
export const PLANS_ON = false;
export const TRIAL_DAYS = 30;
export const FREE_ADMINS = 2, FREE_FIELDS = 2;

/** "free", "pro" or "club" for a billing record at a moment. */
export function planOf(b, now = Date.now()) {
  if (!b || typeof b !== "object") return "free";
  const today = new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
  if ((b.plan === "pro" || b.plan === "club") && typeof b.until === "string" && today <= b.until) return b.plan;
  if (typeof b.trial === "number" && now < b.trial) return "pro";
  return "free";
}
/** May this team use Pro features (emails, selections…)? Always while the plans are off. */
export const isPro = (b, now = Date.now(), on = PLANS_ON) => !on || planOf(b, now) !== "free";
