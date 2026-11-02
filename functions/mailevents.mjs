// Brevo's webhook for transactional email: what went wrong after Brevo accepted a mail (rejected sender, bounce, blocked,
// spam complaint…). Brevo calls brevoEvents (index.js) with the shared token; the problems are kept in mailEvents/<id>
// and go into the daily error email (errors.mjs). Only problems are kept; "delivered", "opened" and the like are ignored.
// Only this function and the daily job read or write mailEvents (no database rule lets the app in).
export const PROBLEMS = ["hard_bounce", "soft_bounce", "blocked", "invalid_email", "error", "spam", "complaint", "deferred"];
const str = (x, n) => (x == null ? "" : String(x)).slice(0, n);

/** Brevo sends one event or a list. Returns the problems as { ev, to, reason, subject, from, at }. */
export function parseEvents(body, now = Date.now()) {
  const list = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  return list.filter(e => e && PROBLEMS.includes(String(e.event || "").toLowerCase())).map(e => {
    const ts = Number(e.ts_event || e.ts) || 0;
    return { ev: String(e.event).toLowerCase(), to: str(e.email, 200).toLowerCase(), reason: str(e.reason, 300),
      subject: str(e.subject, 160), from: str(e.sender_email || e.from, 120), at: ts > 1e9 && ts < 1e10 ? ts * 1000 : now };
  });
}

/** One webhook call: checks the token, stores the problems. Returns { status, body }. */
export async function handleMailEvents({ db, body, token, expected, now = Date.now() }) {
  if (!expected || token !== expected) return { status: 401, body: { error: "token" } };
  const events = parseEvents(body, now);
  for (const e of events) await db.ref("mailEvents").push(e);
  if (events.length) console.log(`brevoEvents: ${events.length} problem(s) kept`);
  return { status: 200, body: { ok: true, kept: events.length } };
}

/** The problems after `since`, grouped by kind and reason. */
export function groupMailEvents(events, since) {
  const groups = new Map();
  for (const e of Object.values(events || {})) {
    if (!e || typeof e.at !== "number" || e.at <= since) continue;
    const key = `${e.ev}\n${e.reason}`;
    const g = groups.get(key) || { ev: e.ev, reason: e.reason, count: 0, to: new Set(), subjects: new Set(), from: new Set(), first: e.at, last: e.at };
    g.count++;
    if (e.to) g.to.add(e.to);
    if (e.subject) g.subjects.add(e.subject);
    if (e.from) g.from.add(e.from);
    g.first = Math.min(g.first, e.at); g.last = Math.max(g.last, e.at);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
