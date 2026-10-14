// RostiQ Cloud Functions.
//
// notice: notices/<team>/<id> (an admin called a match off or moved it): a notification to every member's devices at
// once, then the notice is removed. The rules only accept a notice for a match that really is cancelled / moved.
//
// calendar: GET /cal/<key>.ics: a player's personal calendar feed (read-only). calKeys/<key> = { t: team, p: player,
// l: language, h: hide "no" matches }. Served through Firebase Hosting (firebase.json rewrite), which caches each feed
// for 15 minutes: calendar apps polling every hour mostly hit that cache, not this function or the database.
// Capped at a few instances, so even a flood of requests can't run up the bill.
import { onRequest } from "firebase-functions/v2/https";
import { onValueCreated } from "firebase-functions/v2/database";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { buildFeed } from "./ics.js";
import { noticeMessage } from "./notice.js";

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
    const [brand, shortName, calendarLabel, sport, schedule, matches, carpool, name, avail] = await Promise.all([
      val(`${T}/info/brand`), val(`${T}/info/shortName`), val(`${T}/info/calendarLabel`), val(`${T}/settings/sport`),
      val(`${T}/schedule`), val(`${T}/matches`), val(`${T}/carpool`), val(`${T}/players/${k.p}/name`), val(`${T}/players/${k.p}/avail`)]);
    if (!name) { gone(); return; }
    // Names of the people in my car / whose car I'm in.
    const ids = new Set();
    for (const cp of Object.values(carpool || {})) {
      const mine = cp && cp[k.p];
      if (!mine) continue;
      if (mine.role === "rider" && mine.with) ids.add(mine.with);
      if (mine.role === "driver") for (const [id, x] of Object.entries(cp)) if (x && x.with === k.p) ids.add(id);
    }
    const names = Object.fromEntries(await Promise.all([...ids].filter(id => /^[A-Za-z0-9_-]{1,40}$/.test(id)).map(async id => [id, await val(`${T}/players/${id}/name`)])));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
    body = buildFeed({ tid: k.t, info: { brand, shortName, calendarLabel }, settings: { sport }, schedule, matches, carpool },
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
export const notice = onValueCreated({ ref: "/notices/{tid}/{id}", instance: "wintermidam-default-rtdb",
  region: process.env.FUNCTIONS_EMULATOR === "true" ? "us-central1" : "europe-west1",
  memory: "256MiB", maxInstances: 3, timeoutSeconds: 60 }, async event => {
  const { tid, id } = event.params, n = event.data.val() || {};
  const done = () => db.ref(`notices/${tid}/${id}`).remove();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(tid)) return done();
  const T = `teams/${tid}`;
  const [brand, sched, match, quickLinks, members, quick] = await Promise.all([val(`${T}/info/brand`), val(`${T}/schedule/${n.d}`),
    val(`${T}/matches/${n.d}`), val(`${T}/settings/quickLinks`), val(`${T}/members`), val(`quickIndex/${tid}`)]);
  // Still the way the notice says (not undone in the meantime)?
  if (!sched || (n.k === "c" && sched.cancelled !== true) || (n.k === "m" && sched.moved !== n.o)) return done();
  const team = { brand, opp: sched.opp, start: (match || {}).start, quickLinks };
  let sent = 0, gone = {};
  for (const [uid, pid] of Object.entries(members || {})) {
    if (uid === n.by) continue; // the admin who did it knows
    for (const [dev, info] of Object.entries((await val(`pushTokens/${uid}`)) || {})) {
      const data = info && info.token && noticeMessage(tid, n, team, (quick || {})[pid] || null, info.lang);
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
