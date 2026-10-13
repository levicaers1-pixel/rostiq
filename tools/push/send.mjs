// RostiQ – daily push reminders (run by .github/workflows/push-reminders.yml).
//
// For every team with automatic reminders on (settings.autoRemind !== false) and every match in the next 3 days,
// linked players who haven't answered yet get a notification on their devices with notifications on:
// "r3" from 3 days before, and a last one ("r1") the day before. pushLog/<team>/<date>/<kind>/<uid> remembers
// what was sent, so a re-run never sends twice. Device tokens that no longer work are removed.
//
// Needs the secret FIREBASE_SERVICE_ACCOUNT (the JSON key of the project's service account).
// Dry run (sends nothing, writes nothing):  DRY_RUN=1 node send.mjs
import admin from "firebase-admin";

const DB_URL = "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app";
const APP = "https://app.rostiq.be";
const DRY = !!process.env.DRY_RUN;
const TZ = "Europe/Brussels";

// Tests: FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 DB_NS=<namespace> DRY_RUN=1 node send.mjs
const EMU = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!sa && !EMU) { console.log("Not set up yet (repository secret FIREBASE_SERVICE_ACCOUNT is missing): nothing sent."); process.exit(0); }
admin.initializeApp(EMU ? { projectId: "demo-rostiq", databaseURL: `http://${EMU}?ns=${process.env.DB_NS || "demo-rostiq"}` }
  : { credential: admin.credential.cert(sa), databaseURL: DB_URL });
const db = admin.database();

// Test: send one notification to the devices of one account (workflow input "test_email"), then stop.
if (process.env.TEST_EMAIL) {
  const user = await admin.auth().getUserByEmail(process.env.TEST_EMAIL).catch(() => null);
  const devices = user ? Object.values((await db.ref(`pushTokens/${user.uid}`).once("value")).val() || {}) : [];
  let ok = 0;
  for (const d of devices) {
    const body = { nl: "Testmelding: meldingen werken op dit toestel ✅", fr: "Notification test : les notifications fonctionnent sur cet appareil ✅",
                   en: "Test notification: notifications work on this device ✅" }[d.lang] || "Test ✅";
    try { await admin.messaging().send({ token: d.token, data: { title: "RostiQ", body, link: `${APP}/`, tag: "test" } }); ok++; }
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
const whenText = (date, lang) => new Date(date + "T12:00:00Z").toLocaleDateString(LOCALES[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const [teamsSnap, tokensSnap, logSnap] = await Promise.all(["teams", "pushTokens", "pushLog"].map(p => db.ref(p).once("value")));
const teams = teamsSnap.val() || {}, tokens = tokensSnap.val() || {}, log = logSnap.val() || {};

let sent = 0, skipped = 0, removed = 0;
const logWrites = {}, deadTokens = {};
for (const [tid, team] of Object.entries(teams)) {
  if (!team || (team.settings || {}).autoRemind === false) continue;
  const brand = (team.info || {}).brand || "RostiQ";
  for (const [date, m] of Object.entries(team.schedule || {})) {
    const d = daysUntil(date);
    const kind = d === 1 ? "r1" : d >= 2 && d <= 3 ? "r3" : null;
    if (!kind) continue;
    for (const [uid, pid] of Object.entries(team.members || {})) {
      const player = (team.players || {})[pid];
      if (!player || (player.avail || {})[date]) continue; // answered already
      if ((((log[tid] || {})[date] || {})[kind] || {})[uid]) continue; // sent already
      const devices = Object.entries(tokens[uid] || {});
      if (!devices.length) { skipped++; continue; }
      for (const [dev, info] of devices) {
        const lang = TEXT[info.lang] ? info.lang : "nl";
        const body = kind === "r1" ? TEXT[lang].r1(m.opp) : TEXT[lang].r3(m.opp, whenText(date, lang));
        const message = {
          token: info.token,
          data: { title: brand, body, link: `${APP}/?t=${encodeURIComponent(tid)}`, tag: `${tid}-${date}` },
          webpush: { headers: { Urgency: "normal", TTL: String(20 * 3600) } },
        };
        if (DRY) { sent++; continue; }
        try { await admin.messaging().send(message); sent++; }
        catch (e) {
          const code = (e && (e.code || e.errorInfo && e.errorInfo.code)) || "";
          if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) { deadTokens[`pushTokens/${uid}/${dev}`] = null; removed++; }
          else console.warn("send failed:", code);
        }
      }
      logWrites[`pushLog/${tid}/${date}/${kind}/${uid}`] = Date.now();
    }
  }
}
// Forget logs of matches that are over.
for (const [tid, dates] of Object.entries(log)) for (const date of Object.keys(dates || {})) if (date < today) logWrites[`pushLog/${tid}/${date}`] = null;

if (process.env.VERBOSE) console.log(JSON.stringify(Object.keys(logWrites).sort()));
if (!DRY && Object.keys({ ...logWrites, ...deadTokens }).length) await db.ref().update({ ...logWrites, ...deadTokens });
// Only counts in the log (the repository is public): no names, teams or tokens.
console.log(`${today}: ${sent} notifications ${DRY ? "would be " : ""}sent, ${skipped} players without notifications, ${removed} old devices removed.`);
process.exit(0);
