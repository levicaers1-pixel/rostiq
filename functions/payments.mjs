// RostiQ Pro, paid through Mollie (https://docs.mollie.com). No Mollie library: two calls to its REST API.
//
// checkout (index.js): a team admin taps "Upgrade" in Beheer. We check they're the team's admin, work out the season and
// the price ourselves (never from the app), create a Mollie payment and keep it in payments/<id> (no app access), and
// send back Mollie's payment page. The admin pays there and comes back to admin.html?paid=1.
// mollieWebhook (index.js): Mollie posts only the payment's id. We ask Mollie for the payment ourselves, so a made-up
// call can't unlock anything; when it's paid and matches what we stored, billing/<team> gets the plan and the season,
// and billing/<team>/history/<id> the receipt. Handling the same call twice changes nothing. A full refund or a
// chargeback (Mollie calls the webhook again) ends that season's Pro.
// With a test key (test_…) only the RostiQ admin can pay, so nobody gets Pro with Mollie's test payments.
// Logs only ids' kinds and outcomes, never names or addresses.
export const PRO_CENTS = 3900;           // € 39 per team per season, VAT included
export const PILOT_DISCOUNT = 0.5;       // pilot teams: 50% off their first paid season
const APP = "https://app.rostiq.be";
const TID = /^[a-z0-9][a-z0-9-]{1,39}$/, PAYMENT_ID = /^tr_[A-Za-z0-9]{4,40}$/;
const LOCALE = { nl: "nl_BE", fr: "fr_BE", en: "en_GB" };

const nextDay = d => new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
/** Seasons run 1 July – 30 June. A purchase covers the season it's made in, from 1 May the coming one; a plan that still
 *  runs is extended by the season after it. Returns the last day ("YYYY-MM-DD"). */
export function seasonUntil(today, runningUntil) {
  const extend = typeof runningUntil === "string" && runningUntil >= today;
  const start = extend ? nextDay(runningUntil) : today;
  const [y, m] = start.split("-").map(Number);
  return `${m >= 7 || (!extend && m >= 5) ? y + 1 : y}-06-30`;
}
/** "2027-28" for a season ending 2028-06-30. */
export const seasonName = until => `${Number(until.slice(0, 4)) - 1}-${until.slice(2, 4)}`;
/** The price in cents. Pilot teams pay half for their first paid season. */
export const priceOf = billing => Math.round(PRO_CENTS * (billing && billing.src === "pilot" ? 1 - PILOT_DISCOUNT : 1));
const euros = cents => (cents / 100).toFixed(2);
// Mollie: a payment stays "paid" when it's refunded; amountRefunded / amountChargedBack say how much came back.
const fullyReturned = p => !!p.amount && (Number((p.amountRefunded || {}).value || 0) >= Number(p.amount.value) || Number((p.amountChargedBack || {}).value || 0) > 0);

/** Mollie's REST API with the key: mollie("POST", "/payments", body) → the JSON answer. */
export function mollieApi(key) {
  return async (method, path, body) => {
    const res = await fetch("https://api.mollie.com/v2" + path, { method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error("mollie " + res.status); e.status = res.status; e.detail = json && json.detail; throw e; }
    return json;
  };
}

/** One "Upgrade" tap: { status, body: { url } }. who = { uid, platform } from the verified sign-in token. */
export async function handleCheckout({ db, body, who, key, mollie, webhookUrl, now = Date.now() }) {
  const tid = String((body && body.tid) || ""), lang = LOCALE[body && body.lang] ? body.lang : "nl";
  if (!TID.test(tid) || (body.plan || "pro") !== "pro") return { status: 400, body: { error: "request" } };
  if (!key) return { status: 503, body: { error: "setup" } };
  if (key.startsWith("test_") && !who.platform) return { status: 403, body: { error: "test" } };
  const val = path => db.ref(path).get().then(s => s.val());
  const [isAdmin, brand, billing] = await Promise.all([val(`teams/${tid}/admins/${who.uid}`), val(`teams/${tid}/info/brand`), val(`billing/${tid}`)]);
  if (isAdmin !== true && !who.platform) return { status: 403, body: { error: "admin" } };
  if (brand == null) return { status: 404, body: { error: "team" } };
  const today = new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
  const running = billing && billing.plan && typeof billing.until === "string" ? billing.until : null;
  const until = seasonUntil(today, running), cents = priceOf(billing);
  const back = `${APP}/admin.html?t=${encodeURIComponent(tid)}&paid=1#sec-plan`;
  const p = await mollie("POST", "/payments", {
    amount: { currency: "EUR", value: euros(cents) },
    description: `RostiQ Pro ${seasonName(until)} · ${String(brand).slice(0, 60)}`,
    redirectUrl: back, cancelUrl: `${APP}/admin.html?t=${encodeURIComponent(tid)}#sec-plan`, webhookUrl, locale: LOCALE[lang],
    metadata: { tid, plan: "pro", until },
  });
  if (!p || !PAYMENT_ID.test(p.id || "") || !p._links || !p._links.checkout) return { status: 502, body: { error: "mollie" } };
  await db.ref(`payments/${p.id}`).set({ tid, plan: "pro", until, cents, by: who.uid, at: now, status: p.status || "open", mode: p.mode || "" });
  console.log(`checkout: ${p.mode || "?"} payment created`);
  return { status: 200, body: { url: p._links.checkout.href } };
}

/** Mollie's webhook: { status, body }. Always 200 for ids we don't know (Mollie's advice: tell callers nothing). */
export async function handleWebhook({ db, id, mollie, now = Date.now() }) {
  const ok = { status: 200, body: "ok" };
  if (!PAYMENT_ID.test(String(id || ""))) return ok;
  const rec = (await db.ref(`payments/${id}`).get()).val();
  if (!rec) return ok;
  const p = await mollie("GET", `/payments/${id}`);
  const writes = { [`payments/${id}/status`]: p.status || "?", [`payments/${id}/seen`]: now };
  const fits = p.metadata && p.metadata.tid === rec.tid && p.metadata.until === rec.until
    && p.amount && p.amount.currency === "EUR" && p.amount.value === euros(rec.cents);
  if (p.status === "paid" && rec.status !== "paid") {
    if (!fits) { console.error("mollieWebhook: a paid payment doesn't match what was stored"); await db.ref().update(writes); return ok; }
    const billing = (await db.ref(`billing/${rec.tid}`).get()).val() || {};
    const until = typeof billing.until === "string" && billing.src === "paid" && billing.until > rec.until ? billing.until : rec.until;
    Object.assign(writes, {
      [`billing/${rec.tid}/plan`]: rec.plan, [`billing/${rec.tid}/until`]: until, [`billing/${rec.tid}/src`]: "paid",
      [`billing/${rec.tid}/history/${id}`]: { at: now, cents: rec.cents, plan: rec.plan, until: rec.until, mode: p.mode || "" },
      [`payments/${id}/paidAt`]: now,
      // What the team had before (a pilot plan, say): back to that if this payment is refunded.
      ...(billing.plan && billing.src !== "paid" ? { [`payments/${id}/before`]: { plan: billing.plan, until: billing.until, src: billing.src } } : {}),
    });
    console.log(`mollieWebhook: ${p.mode || "?"} payment paid, plan set`);
  } else if (rec.paidAt && !rec.refundedAt && fullyReturned(p)) {
    // Refunded in full in Mollie's dashboard, or charged back: this season's Pro ends. The plan comes from the other paid
    // seasons still standing, else what the team had before paying (if it still runs), else none (Free).
    const billing = (await db.ref(`billing/${rec.tid}`).get()).val() || {};
    writes[`payments/${id}/refundedAt`] = now;
    writes[`billing/${rec.tid}/history/${id}/refunded`] = true;
    if (billing.src === "paid") {
      const today = new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
      const left = Object.entries(billing.history || {}).filter(([hid, h]) => hid !== id && h && !h.refunded && typeof h.until === "string").map(([, h]) => h.until).sort().pop();
      const back = rec.before && typeof rec.before.until === "string" && rec.before.until >= today ? rec.before : null;
      const next = left ? { plan: rec.plan, until: left, src: "paid" } : back || { plan: null, until: null, src: null };
      for (const k of ["plan", "until", "src"]) writes[`billing/${rec.tid}/${k}`] = next[k];
    }
    console.log(`mollieWebhook: ${p.mode || "?"} payment returned, plan updated`);
  } else console.log(`mollieWebhook: status ${p.status}`);
  await db.ref().update(writes);
  return ok;
}
