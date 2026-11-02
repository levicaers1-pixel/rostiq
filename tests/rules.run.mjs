// Starts the Firebase database emulator and runs rules.test.mjs in it. Needs Java (11 or newer) on this computer:
// either "java" on the PATH or JAVA_HOME set. Firebase's own tool is fetched with npx.
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
// A Java runtime unpacked in tests/.jre/<folder> (not in git) is used when JAVA_HOME isn't set.
const local = path.join(HERE, ".jre");
if (!env.JAVA_HOME && fs.existsSync(local)) {
  const dir = fs.readdirSync(local).find(d => fs.existsSync(path.join(local, d, "bin")));
  if (dir) env.JAVA_HOME = path.join(local, dir);
}
const PATH = Object.keys(env).find(k => k.toUpperCase() === "PATH") || "PATH"; // "Path" on Windows
if (env.JAVA_HOME) env[PATH] = path.join(env.JAVA_HOME, "bin") + path.delimiter + (env[PATH] || "");
const java = spawnSync("java -version", { env, shell: true, stdio: "ignore" });
if (java.status !== 0) {
  console.error("The rules tests need Java 11+ (the Firebase emulator runs on it). Install it (e.g. https://adoptium.net) or set JAVA_HOME.");
  process.exit(2);
}
// Rules come from database.rules.json: rebuild it first if tools/build_rules.py is newer.
const rules = path.join(HERE, "../database.rules.json"), build = path.join(HERE, "../tools/build_rules.py");
if (fs.statSync(build).mtimeMs > fs.statSync(rules).mtimeMs) console.warn("Note: tools/build_rules.py is newer than database.rules.json. Run: python tools/build_rules.py");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(`${npx} -y firebase-tools@latest emulators:exec --only database --project demo-rostiq "node tests/rules.test.mjs"`,
  { cwd: path.join(HERE, ".."), env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
