// Database rules tests: the core of who may read and write what, against the Firebase emulator with
// database.rules.json. Run through rules.run.mjs (it starts the emulator):  cd tests && npm run rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = await initializeTestEnvironment({
  projectId: "demo-rostiq",
  database: { rules: fs.readFileSync(path.join(HERE, "../database.rules.json"), "utf8"), host: "127.0.0.1", port: 9000 },
});
const PA_EMAIL = "levicaers1@gmail.com"; // tools/build_rules.py PLATFORM_ADMINS
const db = (uid, email) => env.authenticatedContext(uid, { email: email || `${uid}@rostiq.test`, email_verified: true }).database();
const anon = env.unauthenticatedContext().database();
const admin = db("u-admin"), member = db("u-member"), stranger = db("u-stranger"), platform = db("u-pa", PA_EMAIL);

async function reset() {
  await env.withSecurityRulesDisabled(async c => {
    await c.database().ref().set({
      teams: { t1: {
        initialized: true,
        info: { brand: "Team One" },
        settings: { sport: "golf", minPlayers: 4 },
        schedule: { "2030-05-01": { opp: "Rivals" } },
        players: { p1: { name: "Admin", uid: "u-admin" }, p2: { name: "Member", uid: "u-member" }, p3: { name: "Unlinked" } },
        members: { "u-admin": "p1", "u-member": "p2" },
        admins: { "u-admin": true },
      } },
      users: { "u-member": { teams: { t1: "p2" } }, "u-admin": { teams: { t1: "p1" } } },
      errors: { e0000000001: { at: 1, items: { 0: { msg: "x" } } } },
      errorReport: { last: 1 },
    });
  });
}

let pass = 0, fail = 0;
async function check(name, fn) {
  await reset();
  try { await fn(); pass++; }
  catch (e) { fail++; console.log("✗ " + name + "\n    " + String(e.message || e).split("\n")[0]); }
}
const T = "teams/t1";

// ---- reading a team ----
await check("not signed in: no team data", () => assertFails(anon.ref(T).get()));
await check("signed in, not a member: no team data", () => assertFails(stranger.ref(T).get()));
await check("member: reads the team", () => assertSucceeds(member.ref(T).get()));
await check("anyone signed in: reads the team's name/logo (waiting screen)", () => assertSucceeds(stranger.ref(`${T}/info`).get()));
await check("not signed in: no team name either", () => assertFails(anon.ref(`${T}/info`).get()));

// ---- a player's own row ----
await check("member: answers for themselves", () => assertSucceeds(member.ref(`${T}/players/p2/avail/2030-05-01`).set("yes")));
await check("member: only yes / maybe / no", () => assertFails(member.ref(`${T}/players/p2/avail/2030-05-01`).set("perhaps")));
await check("member: can't answer for someone else", () => assertFails(member.ref(`${T}/players/p3/avail/2030-05-01`).set("yes")));
await check("member: changes their own name", () => assertSucceeds(member.ref(`${T}/players/p2/name`).set("New Name")));
await check("member: can't rename someone else", () => assertFails(member.ref(`${T}/players/p1/name`).set("Hacked")));
await check("member: can't link themselves to another player", () => assertFails(member.ref(`${T}/players/p3/uid`).set("u-member")));
await check("member: training answer yes / no only", async () => {
  await assertSucceeds(member.ref(`${T}/players/p2/tr/2030-05-02`).set("no"));
  await assertFails(member.ref(`${T}/players/p2/tr/2030-05-02`).set("maybe"));
});
await check("member: no unknown fields on a player", () => assertFails(member.ref(`${T}/players/p2/isAdmin`).set(true)));

// ---- team admin only ----
await check("member: can't change settings", () => assertFails(member.ref(`${T}/settings/minPlayers`).set(9)));
await check("admin: changes settings", () => assertSucceeds(admin.ref(`${T}/settings/minPlayers`).set(5)));
await check("admin: home/away on or off (boolean only)", async () => {
  await assertSucceeds(admin.ref(`${T}/settings/homeAway`).set(true));
  await assertFails(admin.ref(`${T}/settings/homeAway`).set("yes"));
});
await check("admin: selections off (true only)", async () => {
  await assertSucceeds(admin.ref(`${T}/settings/selOff`).set(true));
  await assertFails(admin.ref(`${T}/settings/selOff`).set(false));
});
await check("admin: no unknown settings", () => assertFails(admin.ref(`${T}/settings/somethingNew`).set(true)));
await check("admin: adds a match", () => assertSucceeds(admin.ref(`${T}/schedule/2030-06-01`).set({ opp: "Another club", home: false })));
await check("admin: a match needs a name", () => assertFails(admin.ref(`${T}/schedule/2030-06-01`).set({ home: true })));
await check("admin: renames a match", () => assertSucceeds(admin.ref(`${T}/schedule/2030-05-01/opp`).set("Rivals II")));
await check("member: can't change the schedule", () => assertFails(member.ref(`${T}/schedule/2030-06-01`).set({ opp: "Fake" })));
await check("admin: changes the team name", () => assertSucceeds(admin.ref(`${T}/info/brand`).set("Team Uno")));
await check("member: can't change the team name", () => assertFails(member.ref(`${T}/info/brand`).set("Hacked")));
await check("admin: colours only as #rrggbb", () => assertFails(admin.ref(`${T}/info/colors/main`).set("red; background:url(x)")));

// ---- golf ranking: scores per match, the tie rule ----
const SCORE = { f: "net", p: { p1: { s: 84, h: 12 }, p2: { s: 90, h: 18 } }, at: 1, by: "u-admin" };
await check("admin: enters a match result", () => assertSucceeds(admin.ref(`${T}/scores/2030-05-01`).set(SCORE)));
await check("member: can't enter results", () => assertFails(member.ref(`${T}/scores/2030-05-01`).set(SCORE)));
await check("member: can't change their own score", () => assertFails(member.ref(`${T}/scores/2030-05-01/p/p2/s`).set(60)));
await check("result: only stb / net / gross", () => assertFails(admin.ref(`${T}/scores/2030-05-01`).set({ ...SCORE, f: "matchplay" })));
await check("result: only for players of the team", () => assertFails(admin.ref(`${T}/scores/2030-05-01`).set({ f: "stb", p: { nobody: { s: 30 } } })));
await check("result: scores are numbers in range", () => assertFails(admin.ref(`${T}/scores/2030-05-01`).set({ f: "stb", p: { p1: { s: "36" } } })));
await check("admin: ties shared or by handicap", async () => {
  await assertSucceeds(admin.ref(`${T}/settings/tie`).set("share"));
  await assertFails(admin.ref(`${T}/settings/tie`).set("coin"));
});

// ---- who is admin / member ----
await check("member: can't make themselves admin", () => assertFails(member.ref(`${T}/admins/u-member`).set(true)));
await check("admin: makes a linked member admin", () => assertSucceeds(admin.ref(`${T}/admins/u-member`).set(true)));
await check("stranger: can't join a team by themselves", () => assertFails(stranger.ref(`${T}/members/u-stranger`).set("p3")));
await check("member: can leave the team", () => assertSucceeds(member.ref(`${T}/members/u-member`).remove()));
await check("member: can't remove someone else", () => assertFails(member.ref(`${T}/members/u-admin`).remove()));

// ---- outside the teams ----
await check("not signed in: nothing at the top", () => assertFails(anon.ref("/").get()));
await check("a user reads their own team list", () => assertSucceeds(member.ref("users/u-member/teams").get()));
await check("a user can't read someone else's", () => assertFails(stranger.ref("users/u-member").get()));
await check("error reports: hidden from users", () => assertFails(member.ref("errors").get()));
await check("error reports: readable by the RostiQ admin", () => assertSucceeds(platform.ref("errors").get()));
await check("error email marker: nobody in the app", async () => {
  await assertFails(platform.ref("errorReport").get());
  await assertFails(member.ref("errorReport/last").set(2));
});
await check("RostiQ admin: reads any team", () => assertSucceeds(platform.ref(T).get()));
await check("unknown top-level paths: refused", () => assertFails(member.ref("whatever/x").set(1)));

await env.cleanup();
console.log(`\n${pass}/${pass + fail} rules checks passed.`);
process.exit(fail ? 1 : 0);
