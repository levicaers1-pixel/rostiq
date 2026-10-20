// RostiQ Cloud Functions.
//
// jobFrequent / jobDaily: the scheduled job (job.mjs) on Firebase's timer: every 10 minutes access requests and email
// invitations, daily at 18:30 Belgian time also the match reminders. (GitHub's timer ran up to hours late; the GitHub
// workflow is now only for running it by hand.) The Brevo login and key are Firebase secrets.
//
// notice: notices/<team>/<id> (an admin called a match off, moved it, or published the selection): a notification to
// every member's devices at once (for a selection: only the selected players and reserves), then the notice is removed. The rules only accept a notice for a match that really is cancelled / moved.
// A reminder (k "a"): to the players who haven't answered, by notification or else email (remind.mjs).
// A request to complete details (k "p"): to the chosen players, by email or else notification (remind.mjs).
//
// calendar: GET /cal/<key>.ics: a player's personal calendar feed (read-only). calKeys/<key> = { t: team, p: player,
// l: language, h: hide "no" matches }. Served through Firebase Hosting (firebase.json rewrite), which caches each feed
// for 15 minutes: calendar apps polling every hour mostly hit that cache, not this function or the database.
// Capped at a few instances, so even a flood of requests can't run up the bill.
import { onRequest } from "firebase-functions/v2/https";
import { onValueCreated, onValueWritten } from "firebase-functions/v2/database";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { buildFeed } from "./ics.js";
import { noticeMessage } from "./notice.js";
import { roleOf, roleText, promoteReserve, subText } from "./lineup.js";
import { runJob } from "./job.mjs";
import { sendReminder, sendProfileAsk } from "./remind.mjs";

initializeApp({ databaseURL: process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${process.env.DB_NS || "demo-rostiq"}`
  : "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app" });
const db = getDatabase();
const val = path => db.ref(path).get().then(s => s.val());

// Per instance: the last answers for a few minutes (a second line of defence behind the Hosting cache).
const memo = new Map();
const MEMO_MS = 5 * 60 * 1000;

export const calendar = onRequest({ region: "europe-west1", memory: "256MiB", maxInstances: 5, timeoutSeconds: 20 }, async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.status(405).send("Method not allowed"); return; }
  const m = /(?:^|\/)([A-Za-z0-9_-]{22})\.ics$/.exec(req.path);
  const gone = () => { res.set("Cache-Control", "public, max-age=300, s-maxage=300"); res.status(404).type("text/plain").send("This calendar link no longer works. Make a new one in RostiQ."); };
  if (!m) { gone(); return; }
  const key = m[1];
  const hit = memo.get(key);
  let body = hit && Date.now() - hit.at < MEMO_MS ? hit.body : null;
  if (!body) {
    const k = await val(`calKeys/${key}`);
    if (!k || typeof k.t !== "string" || typeof k.p !== "string" || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(k.t)) { gone(); return; }
    const T = `teams/${k.t}`;
    // Only what the feed needs: no photos, logos or other players' answers.
    const [brand, shortName, calendarLabel, sport, schedule, matches, carpool, name, avail, selection] = await Promise.all([
      val(`${T}/info/brand`), val(`${T}/info/shortName`), val(`${T}/info/calendarLabel`), val(`${T}/settings/sport`),
      val(`${T}/schedule`), val(`${T}/matches`), val(`${T}/carpool`), val(`${T}/players/${k.p}/name`), val(`${T}/players/${k.p}/avail`),
      val(`${T}/selection`)]);
    if (!name) { gone(); return; }
    // Names of the people in my car / whose car I'm in, and my partner in a pair.
    const ids = new Set();
    for (const sm of Object.values(selection || {})) {
      const mine = sm && sm.pair && sm.pair[k.p];
      if (mine) for (const [id, n] of Object.entries(sm.pair)) if (id !== k.p && n === mine) ids.add(id);
    }
    for (const cp of Object.values(carpool || {})) {
      const mine = cp && cp[k.p];
      if (!mine) continue;
      if (mine.role === "rider" && mine.with) ids.add(mine.with);
      if (mine.role === "driver") for (const [id, x] of Object.entries(cp)) if (x && x.with === k.p) ids.add(id);
    }
    const names = Object.fromEntries(await Promise.all([...ids].filter(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)).map(async id => [id, await val(`${T}/players/${id}/name`)])));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
    body = buildFeed({ tid: k.t, info: { brand, shortName, calendarLabel }, settings: { sport }, schedule, matches, carpool, selection },
      { pid: k.p, name, avail }, names, { lang: k.l, hideNo: k.h === true, today });
    memo.set(key, { at: Date.now(), body });
    if (memo.size > 2000) memo.delete(memo.keys().next().value);
  }
  res.set("Cache-Control", "public, max-age=900, s-maxage=900");
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", 'inline; filename="rostiq.ics"');
  res.status(200).send(req.method === "HEAD" ? "" : body);
});

// The trigger runs where the database is (europe-west1); the local emulator's database counts as us-central1.
const BREVO = [defineSecret("BREVO_SMTP_LOGIN"), defineSecret("BREVO_SMTP_KEY")];

export const notice = onValueCreated({ ref: "/notices/{tid}/{id}", instance: "wintermidam-default-rtdb",
  region: process.env.FUNCTIONS_EMULATOR === "true" ? "us-central1" : "europe-west1",
  memory: "256MiB", maxInstances: 3, timeoutSeconds: 120, secrets: BREVO }, async event => {
  const { tid, id } = event.params, n = event.data.val() || {};
  const done = () => db.ref(`notices/${tid}/${id}`).remove();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(tid)) return done();
  if (n.k === "a" || n.k === "p") { // a reminder / a request to complete details: own recipients, also by email
    try { await (n.k === "a" ? sendReminder : sendProfileAsk)(db, tid, n); } catch (e) { console.error(`notice ${n.k} failed:`, (e && e.code) || "error"); }
    return done();
  }
  const T = `teams/${tid}`;
  const [brand, sched, match, quickLinks, members, quick, selection] = await Promise.all([val(`${T}/info/brand`), val(`${T}/schedule/${n.d}`),
    val(`${T}/matches/${n.d}`), val(`${T}/settings/quickLinks`), val(`${T}/members`), val(`quickIndex/${tid}`), val(`${T}/selection/${n.d}`)]);
  // Still the way the notice says (not undone in the meantime)?
  if (!sched || (n.k === "c" && sched.cancelled !== true) || (n.k === "m" && sched.moved !== n.o) || (n.k === "s" && !(selection && selection.pub))) return done();
  // For a selection: each player's full role (position, number, pair with whom), so the message can say it.
  const names = n.k === "s" ? (await val(`${T}/players`)) || {} : {};
  const placeOf = pid => {
    const r = roleOf(selection, pid);
    return r ? { ...r, mateName: r.mate ? String((names[r.mate] || {}).name || "").trim().split(/\s+/)[0] : "" } : null;
  };
  const team = { brand, opp: sched.opp, start: (match || {}).start, quickLinks };
  let sent = 0, gone = {};
  for (const [uid, pid] of Object.entries(members || {})) {
    if (uid === n.by) continue; // the admin who did it knows
    for (const [dev, info] of Object.entries((await val(`pushTokens/${uid}`)) || {})) {
      const data = info && info.token && noticeMessage(tid, n, team, (quick || {})[pid] || null, info.lang, placeOf(pid));
      if (!data) continue;
      try { await getMessaging().send({ token: info.token, data, webpush: { headers: { Urgency: "high", TTL: String(24 * 3600) } } }); sent++; }
      catch (e) {
        const code = (e && (e.code || e.errorInfo && e.errorInfo.code)) || "";
        if (/registration-token-not-registered|invalid-registration-token/.test(code)) gone[`pushTokens/${uid}/${dev}`] = null;
      }
    }
  }
  if (Object.keys(gone).length) await db.ref().update(gone);
  console.log(`notice ${n.k}: ${sent} notifications sent`);
  return done();
});

// dropout: a selected player switches to "no" (or a holiday sets it) for a match with a published selection: reserve 1
// takes their exact place (position, number, pair), and gets a notification with their role; the admins hear who left and
// who stepped in (or that no reserve is left); riders of a driver who left hear their lift is gone. Teams can switch it
// off (settings/sel/auto = false): then only the admins are told.
export const dropout = onValueWritten({ ref: "/teams/{tid}/players/{pid}/avail/{date}", instance: "wintermidam-default-rtdb",
  region: process.env.FUNCTIONS_EMULATOR === "true" ? "us-central1" : "europe-west1",
  memory: "256MiB", maxInstances: 3, timeoutSeconds: 60 }, async event => {
  const { tid, pid, date } = event.params;
  if (event.data.after.val() !== "no" || event.data.before.val() === "no") return;
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(tid) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const T = `teams/${tid}`, today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
  if (date < today) return;
  const [sched, match, brand, auto, players, admins, members, carpool] = await Promise.all([val(`${T}/schedule/${date}`), val(`${T}/matches/${date}`),
    val(`${T}/info/brand`), val(`${T}/settings/sel/auto`), val(`${T}/players`), val(`${T}/admins`), val(`${T}/members`), val(`${T}/carpool/${date}`)]);
  if (!sched || !sched.opp || sched.cancelled === true) return;
  // In a transaction, so two players dropping out at the same moment can't both get the same reserve.
  let result = null;
  const tx = await db.ref(`${T}/selection/${date}`).transaction(sel => {
    result = null;
    if (sel === null) return null; // first try may run before the data is known: "no change", Firebase retries with the real value
    if (!sel.pub || !sel.p || sel.p[pid] !== "s") return; // not selected: nothing to do
    if (auto === false) { result = { sel, in: null, manual: true }; return; } // no change; just tell the admins
    result = promoteReserve(sel, pid);
    return result.sel;
  });
  if (!result || (!tx.committed && !result.manual)) return;
  const first = id => String(((players || {})[id] || {}).name || "").trim().split(/\s+/)[0] || "?";
  const out = first(pid), sub = result.in ? first(result.in) : null, opp = String(sched.opp).slice(0, 60);
  const uidOf = id => Object.keys(members || {}).find(u => members[u] === id);
  const when = lang => new Date(date + "T12:00:00Z").toLocaleDateString({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[lang] || "nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const base = { title: String(brand || "RostiQ").slice(0, 60), link: `https://app.rostiq.be/?t=${encodeURIComponent(tid)}` };
  let sent = 0;
  const pushTo = async (uid, body) => {
    for (const [dev, info] of Object.entries((uid && (await val(`pushTokens/${uid}`))) || {})) {
      if (!info || !info.token) continue;
      try { await getMessaging().send({ token: info.token, data: { ...base, tag: `${tid}-sel-${date}`, body: body(info.lang) }, webpush: { headers: { Urgency: "high", TTL: String(24 * 3600) } } }); sent++; }
      catch (e) { const code = (e && (e.code || e.errorInfo && e.errorInfo.code)) || ""; if (/registration-token-not-registered|invalid-registration-token/.test(code)) await db.ref(`pushTokens/${uid}/${dev}`).remove(); }
    }
  };
  // The reserve: you're in, with your role.
  if (result.in) {
    const role = roleOf(result.sel, result.in), mate = role && role.mate ? first(role.mate) : "";
    await pushTo(uidOf(result.in), lang => [subText("in", lang, { out, opp, when: when(lang) }), roleText(role, lang, mate)].filter(Boolean).join(" "));
  }
  // The admins (not the player who left, if they're an admin themselves).
  for (const uid of Object.keys(admins || {})) if (admins[uid] === true && members && members[uid] !== pid)
    await pushTo(uid, lang => subText(result.manual ? "manual" : "admin", lang, { out, sub, opp }));
  // A driver who left: their riders need a new lift (the ride itself is cleared).
  const cp = carpool || {}, mine = cp[pid], fix = {};
  if (!result.manual && mine) {
    fix[`${T}/carpool/${date}/${pid}`] = null;
    if (mine.role === "driver") for (const [id, x] of Object.entries(cp)) if (x && x.role === "rider" && x.with === pid) {
      fix[`${T}/carpool/${date}/${id}/with`] = null;
      await pushTo(uidOf(id), lang => subText("ride", lang, { out, opp }));
    }
  }
  if (Object.keys(fix).length) await db.ref().update(fix);
  console.log(`dropout: ${result.manual ? "admins told (automatic replacement off)" : result.in ? "reserve stepped in" : "no reserve left"}, ${sent} notifications`);
});

// Every 10 minutes at :05, :15, … (so it never runs at the same moment as the daily job at :30).
const JOB = { region: "europe-west1", timeZone: "Europe/Brussels", memory: "512MiB", timeoutSeconds: 300, maxInstances: 1, retryCount: 0, secrets: BREVO };
export const jobFrequent = onSchedule({ ...JOB, schedule: "5-55/10 * * * *" }, () => runJob({ mode: "requests" }));
export const jobDaily = onSchedule({ ...JOB, schedule: "30 18 * * *" }, () => runJob({ mode: "all" }));
