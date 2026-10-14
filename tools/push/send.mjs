// RostiQ: daily push reminders (run by .github/workflows/push-reminders.yml).
//
// For every team with automatic reminders on (settings.autoRemind !== false) and every match in the next 3 days,
// linked players who haven't answered yet get a notification on their devices with notifications on:
// "r3" from 3 days before, and a last one ("r1") the day before. pushLog/<team>/<date>/<kind>/<uid> remembers
// what was sent, so a re-run never sends twice. Device tokens that no longer work are removed.
//
// Needs the secret FIREBASE_SERVICE_ACCOUNT (the JSON key of the project's service account).
// Dry run (sends nothing, writes nothing):  DRY_RUN=1 node send.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import crypto from "node:crypto";
import { runInvites } from "./invites.mjs";

const DB_URL = "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app";
const APP = "https://app.rostiq.be";
const DRY = !!process.env.DRY_RUN;
const TZ = "Europe/Brussels";

// Tests: FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 DB_NS=<namespace> DRY_RUN=1 node send.mjs
const EMU = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!sa && !EMU) { console.log("Not set up yet (repository secret FIREBASE_SERVICE_ACCOUNT is missing): nothing sent."); process.exit(0); }
initializeApp(EMU ? { projectId: "demo-rostiq", databaseURL: `http://${EMU}?ns=${process.env.DB_NS || "demo-rostiq"}` }
  : { credential: cert(sa), databaseURL: DB_URL });
const db = getDatabase();

const ACTIONS_TEST = { nl: [["yes", "✅ Ja"], ["no", "❌ Nee"]], fr: [["yes", "✅ Oui"], ["no", "❌ Non"]], en: [["yes", "✅ Yes"], ["no", "❌ No"]] };
// Test: send one notification to the devices of one account (workflow input "test_email"), then stop.
if (process.env.TEST_EMAIL) {
  const user = await getAuth().getUserByEmail(process.env.TEST_EMAIL).catch(() => null);
  const devices = user ? Object.values((await db.ref(`pushTokens/${user.uid}`).once("value")).val() || {}) : [];
  let ok = 0;
  for (const d of devices) {
    const body = { nl: "Testmelding: meldingen werken op dit toestel ✅ (de knoppen openen gewoon de app)", fr: "Notification test : les notifications fonctionnent sur cet appareil ✅ (les boutons ouvrent simplement l'app)",
                   en: "Test notification: notifications work on this device ✅ (the buttons just open the app)" }[d.lang] || "Test ✅";
    const lang = ACTIONS_TEST[d.lang] ? d.lang : "nl";
    const data = { title: "RostiQ", body, link: `${APP}/`, tag: "test",
      actions: JSON.stringify(ACTIONS_TEST[lang].map(([action, title]) => ({ action, title }))), links: JSON.stringify({ yes: `${APP}/`, no: `${APP}/` }) };
    try { await getMessaging().send({ token: d.token, data }); ok++; }
    catch (e) { console.warn("test send failed:", (e && e.code) || e); }
  }
  console.log(`Test: ${user ? "account found" : "no account with that email"}, ${devices.length} device(s), ${ok} sent.`);
  process.exit(0);
}

// Today in Belgium, and whole days until a match date (YYYY-MM-DD).
const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const daysUntil = date => Math.round((Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);

const LOCALES = { nl: "nl-BE", fr: "fr-BE", en: "en-GB" };
const TEXT = {
  nl: { r3: (opp, when) => `${when}: ${opp}. Je hebt nog niet laten weten of je erbij bent 👉 tik om te antwoorden.`,
        r1: (opp) => `Morgen: ${opp}. Laat nog snel weten of je erbij bent 👉` },
  fr: { r3: (opp, when) => `${when} : ${opp}. Tu n'as pas encore dit si tu seras là 👉 touche pour répondre.`,
        r1: (opp) => `Demain : ${opp}. Dis vite si tu seras là 👉` },
  en: { r3: (opp, when) => `${when}: ${opp}. You haven't said yet whether you can make it 👉 tap to answer.`,
        r1: (opp) => `Tomorrow: ${opp}. Let the team know quickly whether you can make it 👉` },
};
// Answer buttons on the notification (Chrome and Edge show the first two, so "maybe" goes last; the notification
// itself opens the answer page with all three).
const ACTIONS = {
  nl: [["yes", "✅ Ja"], ["no", "❌ Nee"], ["maybe", "❓ Misschien"]],
  fr: [["yes", "✅ Oui"], ["no", "❌ Non"], ["maybe", "❓ Peut-être"]],
  en: [["yes", "✅ Yes"], ["no", "❌ No"], ["maybe", "❓ Maybe"]],
};
// A player's personal answer link (the same key the app makes: quickKeys/<key> = { t, p, at }, quickIndex/<team>/<pid>).
// With it a button answers without being signed in. Without (team turned personal links off): the app, signed in.
const newKey = () => crypto.randomBytes(16).toString("base64url"); // 128 bits, 22 characters
const yymmdd = date => date.slice(2).replace(/-/g, "");
function answerLinks(tid, date, key) {
  if (key) return { open: `${APP}/a/?${key}q${yymmdd(date)}`, yes: `${APP}/a/?${key}y${yymmdd(date)}`, maybe: `${APP}/a/?${key}m${yymmdd(date)}`, no: `${APP}/a/?${key}n${yymmdd(date)}` };
  const app = `${APP}/?t=${encodeURIComponent(tid)}`;
  return { open: app, yes: `${app}&ans=yes&d=${date}`, maybe: `${app}&ans=maybe&d=${date}`, no: `${app}&ans=no&d=${date}` };
}
const whenText = (date, lang) => new Date(date + "T12:00:00Z").toLocaleDateString(LOCALES[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const [teamsSnap, tokensSnap, logSnap, quickSnap, subsSnap, invLogSnap, reqSnap] = await Promise.all(["teams", "pushTokens", "pushLog", "quickIndex", "inviteSubs", "inviteLog", "requests"].map(p => db.ref(p).once("value")));
const teams = teamsSnap.val() || {}, tokens = tokensSnap.val() || {}, log = logSnap.val() || {}, quickIndex = quickSnap.val() || {};

// MODE=requests (every 10 minutes): only new access requests. Otherwise (daily run, manual run): everything.
const MODE = process.env.MODE || "all";
let sent = 0, skipped = 0, removed = 0, reqSent = 0, madeKeys = 0, histCleaned = 0;
const logWrites = {}, deadTokens = {};

// One notification to one device; devices that no longer exist are removed.
async function push(uid, dev, info, data) {
  if (DRY) { if (process.env.VERBOSE) console.log(JSON.stringify(data)); return true; }
  try { await getMessaging().send({ token: info.token, data, webpush: { headers: { Urgency: "normal", TTL: String(20 * 3600) } } }); return true; }
  catch (e) {
    const code = (e && (e.code || e.errorInfo && e.errorInfo.code)) || "";
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) { deadTokens[`pushTokens/${uid}/${dev}`] = null; removed++; }
    else console.warn("send failed:", code);
    return false;
  }
}

// ---- New access requests -> the team's admins (pushLog/_req/<team>/<uid> = notified) ----
const REQ_TEXT = {
  nl: name => `Nieuwe toegangsaanvraag: ${name}. Tik om te bekijken.`,
  fr: name => `Nouvelle demande d'accès : ${name}. Touche pour voir.`,
  en: name => `New access request: ${name}. Tap to review.`,
};
// Access requests live in requests/<team>/<uid> (only admins read them). Old ones still inside a team are moved there.
const allReqs = reqSnap.val() || {};
let movedReqs = 0;
for (const [tid, team] of Object.entries(teams)) {
  for (const [uid, rq] of Object.entries((team && team.requests) || {})) {
    if (!(allReqs[tid] || {})[uid] && rq) { (allReqs[tid] = allReqs[tid] || {})[uid] = rq; logWrites[`requests/${tid}/${uid}`] = rq; }
    logWrites[`teams/${tid}/requests/${uid}`] = null;
    movedReqs++;
  }
}
for (const tid of Object.keys(allReqs)) if (!teams[tid]) { logWrites[`requests/${tid}`] = null; delete allReqs[tid]; } // team deleted
const reqLog = log._req || {};
for (const [tid, team] of Object.entries(teams)) {
  if (!team) continue;
  const reqs = allReqs[tid] || {}, brand = (team.info || {}).brand || "RostiQ";
  for (const [uid, rq] of Object.entries(reqs)) {
    if ((reqLog[tid] || {})[uid]) continue; // notified already
    // Only recent requests: ones that were already waiting when this started are just marked as known.
    if (rq && typeof rq.at === "number" && Date.now() - rq.at < 24 * 3600e3) {
      for (const adminUid of Object.keys(team.admins || {})) {
        for (const [dev, info] of Object.entries(tokens[adminUid] || {})) {
          const lang = REQ_TEXT[info.lang] ? info.lang : "nl";
          const body = REQ_TEXT[lang](String(rq.name || "?").slice(0, 60));
          if (await push(adminUid, dev, info, { title: brand, body, link: `${APP}/admin.html?t=${encodeURIComponent(tid)}#requests-panel`, tag: `req-${tid}-${uid}` })) reqSent++;
        }
      }
    }
    logWrites[`pushLog/_req/${tid}/${uid}`] = Date.now();
  }
  // Approved or rejected: forget it.
  for (const uid of Object.keys(reqLog[tid] || {})) if (!reqs[uid]) logWrites[`pushLog/_req/${tid}/${uid}`] = null;
}

// ---- Calendar invitations by email (every run): new / changed / cancelled matches, see invites.mjs ----
const inv = await runInvites({ teams, subs: subsSnap.val() || {}, log: invLogSnap.val() || {}, today, dry: DRY, verbose: !!process.env.VERBOSE });
Object.assign(logWrites, inv.writes);

if (MODE !== "requests") {
  // ---- Match reminders: players who haven't answered, 3 days and 1 day before ----
  for (const [tid, team] of Object.entries(teams)) {
    if (!team || (team.settings || {}).autoRemind === false) continue;
    const brand = (team.info || {}).brand || "RostiQ";
    for (const [date, m] of Object.entries(team.schedule || {})) {
      if (!m || m.cancelled === true) continue; // called off: nothing to answer
      const d = daysUntil(date);
      const kind = d === 1 ? "r1" : d >= 2 && d <= 3 ? "r3" : null;
      if (!kind) continue;
      for (const [uid, pid] of Object.entries(team.members || {})) {
        const player = (team.players || {})[pid];
        if (!player || (player.avail || {})[date]) continue; // answered already
        if ((((log[tid] || {})[date] || {})[kind] || {})[uid]) continue; // sent already
        const devices = Object.entries(tokens[uid] || {});
        if (!devices.length) { skipped++; continue; }
        let key = null;
        if ((team.settings || {}).quickLinks !== false && player.name) {
          key = (quickIndex[tid] || {})[pid];
          if (!key) { // made once, kept until an admin resets it (like the ones the app makes)
            key = newKey();
            (quickIndex[tid] = quickIndex[tid] || {})[pid] = key;
            logWrites[`quickKeys/${key}`] = { t: tid, p: pid, at: ServerValue.TIMESTAMP };
            logWrites[`quickIndex/${tid}/${pid}`] = key;
            madeKeys++;
          }
        }
        const links = answerLinks(tid, date, key);
        for (const [dev, info] of devices) {
          const lang = TEXT[info.lang] ? info.lang : "nl";
          const body = kind === "r1" ? TEXT[lang].r1(m.opp) : TEXT[lang].r3(m.opp, whenText(date, lang));
          const actions = JSON.stringify(ACTIONS[lang].map(([action, title]) => ({ action, title })));
          if (await push(uid, dev, info, { title: brand, body, link: links.open, links: JSON.stringify({ yes: links.yes, maybe: links.maybe, no: links.no }), actions, tag: `${tid}-${date}` })) sent++;
        }
        logWrites[`pushLog/${tid}/${date}/${kind}/${uid}`] = Date.now();
      }
    }
  }
  // Forget logs of matches that are over.
  for (const [tid, dates] of Object.entries(log)) if (tid !== "_req") for (const date of Object.keys(dates || {})) if (date < today) logWrites[`pushLog/${tid}/${date}`] = null;
  // Answer history: only kept until the match has been played (it stays small: only upcoming matches remain).
  const history = (await db.ref("history").once("value")).val() || {};
  for (const [tid, dates] of Object.entries(history))
    for (const date of Object.keys(dates || {})) if (date < today) { logWrites[`history/${tid}/${date}`] = null; histCleaned++; }
}

if (process.env.VERBOSE) console.log(JSON.stringify(Object.keys(logWrites).sort()));
if (!DRY && Object.keys({ ...logWrites, ...deadTokens }).length) await db.ref().update({ ...logWrites, ...deadTokens });

// Anonymous accounts (made by personal answer links) unused for 60 days: removed with their link session.
// Someone who taps their link later simply gets a new one. Daily only; not available in the emulator test.
if (MODE !== "requests" && !EMU) {
  const cutoff = Date.now() - 60 * 864e5, old = [];
  let page;
  do {
    page = await getAuth().listUsers(1000, page && page.pageToken);
    for (const u of page.users) {
      const anonymous = !u.email && !u.phoneNumber && u.providerData.length === 0;
      const last = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime || u.metadata.creationTime);
      if (anonymous && last < cutoff) old.push(u.uid);
    }
  } while (page.pageToken);
  if (!DRY && old.length) {
    for (let i = 0; i < old.length; i += 1000) await getAuth().deleteUsers(old.slice(i, i + 1000));
    await db.ref().update(Object.fromEntries(old.map(uid => [`quickSessions/${uid}`, null])));
  }
  console.log(`${old.length} unused anonymous accounts ${DRY ? "would be " : ""}cleaned up (older than 60 days).`);
}

// Only counts in the log (the repository is public): no names, teams or tokens.
const would = DRY ? "would be " : "";
console.log(`${today}: ${inv.stats.sent} invitations, ${inv.stats.updated} updates, ${inv.stats.cancelled} cancellations ${would}sent (${inv.stats.waiting} waiting, ${inv.stats.failed} failed).`);
if (movedReqs) console.log(`${movedReqs} access requests ${would}moved out of the team data.`);
console.log(`${today}: ${reqSent} access-request notifications ${would}sent to admins` + (MODE === "requests" ? "." :
  `, ${sent} reminders ${would}sent, ${skipped} players without notifications, ${removed} old devices removed, ${madeKeys} personal links ${would}made, ${histCleaned} played matches' answer history ${would}cleaned up.`));
process.exit(0);
