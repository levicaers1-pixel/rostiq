// Run the scheduled job by hand (GitHub Actions "Push reminders", or locally). Normally Firebase runs it on its own
// timer (functions/index.js); this is the backup and the test button.
//   FIREBASE_SERVICE_ACCOUNT=<json> node cli.mjs               everything (MODE=requests: the 10-minute part only)
//   DRY_RUN=1 ... node cli.mjs                                  only count: sends nothing, writes nothing
//   TEST_EMAIL=me@x.be ... node cli.mjs                         one test notification to that account's devices
// Tests: FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 DB_NS=<namespace> DRY_RUN=1 node cli.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { runJob, sendTest } from "./job.mjs";

const EMU = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "null");
if (!sa && !EMU) { console.log("Not set up (secret FIREBASE_SERVICE_ACCOUNT is missing): nothing sent."); process.exit(0); }
initializeApp(EMU ? { projectId: "demo-rostiq", databaseURL: `http://${EMU}?ns=${process.env.DB_NS || "demo-rostiq"}` }
  : { credential: cert(sa), databaseURL: "https://wintermidam-default-rtdb.europe-west1.firebasedatabase.app" });

if (process.env.TEST_EMAIL) await sendTest(process.env.TEST_EMAIL);
else await runJob({ mode: process.env.MODE || "all", dry: !!process.env.DRY_RUN, verbose: !!process.env.VERBOSE, cleanAccounts: !EMU });
process.exit(0);
