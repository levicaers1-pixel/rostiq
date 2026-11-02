# RostiQ tests

Run these before every push. Everything runs on this computer, nothing touches the live database.
GitHub runs `test:all` on every push too (`.github/workflows/tests.yml`, the "Tests" tab under Actions), and also checks
that `database.rules.json` was rebuilt from `tools/build_rules.py`. A failed run keeps the screenshots for 7 days.

```
cd tests
npm install        # once
npm test           # Cloud Function tests + page smoke test   (needs Edge or Chrome)
npm run test:all   # the same + database rules tests           (also needs Java 11+)
```

Java for the rules tests: `JAVA_HOME`, `java` on the PATH, or a Java runtime unpacked in `tests/.jre/<folder>` (not in
git; on Levi's PC: Eclipse Temurin 21 JRE from adoptium.net, checksum verified).

## What's checked

- **`npm run functions`**: the Cloud Function tests (`functions/ics.test.mjs`): calendar feed, notifications,
  reminder and announcement emails, line-ups, weather, trainings, the daily error email.
- **`npm run smoke`** (`smoke.mjs`): opens every main page as a **signed-in** user, on a phone (light and dark) and a
  desktop: Home, Kalender, the match page (all tabs), Ploeg, Carpool, Admin (overview, a section, settings),
  Mijn profiel and the personal answer link. It fails on script errors, pages that never get live data, missing
  content, raw text keys, "undefined", selections shown when a team switched them off, and pages wider than the screen.
  Screenshots land in `tests/out/` (not committed). `ONLY=fresh npm run smoke` runs only pages whose name contains "fresh".
- **`npm run rules`** (`rules.test.mjs`): the core database rules (who reads a team, own answers only, admin-only
  settings and schedule, no self-made admins, hidden error reports, valid values for settings) against the Firebase
  emulator with `database.rules.json`. After changing `tools/build_rules.py`, run `python tools/build_rules.py` first.

## The test teams (`fixtures.mjs`)

- **fresh**: a new golf team. The test user's player has never answered, selections are off, no match details yet.
  (The situation that broke Home for the first pilot team.)
- **full**: a hockey team in use: answers, match details, carpool, a published selection, an announcement, trainings.

The test user (`tester@rostiq.test`) is player and admin in both. Add a team or a page check when a bug slips through,
so it can't come back.

## The test server (`mock/server.cjs`)

Serves the app from the repo with a stand-in Firebase database and a fake sign-in (`mock/fake-sdk/`): no Google
account, no rules. Start it on its own to click around: `npm run server` (http://localhost:8765, empty database;
`SEED=file.json` loads data, `PA=1` makes the test user a RostiQ admin). `localStorage.fakeUser` decides who's signed in.
