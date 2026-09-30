# Team Availability

A shared schedule and availability grid for the 2026–2027 season (15 players by default, more can be added).

**Live page:** https://levicaers1-pixel.github.io/team-availability/

- Tap a cell to cycle: – → ✓ Available → ? Maybe → ✗ Not available
- Player names are editable; totals per match are shown at the bottom
- Everything is stored in a Firebase Realtime Database and updates live for everyone with the page open
- **Export CSV** downloads the full grid

### Carpool page (`carpool.html`)

- Pick your name once (remembered on that device) and fill in your **gemeente**
- Per upcoming match: offer a car with a number of seats and a departure note, or ask for a ride
- Riders can join a car; drivers can take waiting riders in their car
- Drivers and riders are sorted by distance from your gemeente (approximate, as the crow flies,
  looked up via OpenStreetMap Nominatim and cached in your browser)
- "Where everyone lives" groups the team by gemeente

To change the schedule, edit the `EVENTS` array in `common.js`.

## One-time setup: Firebase (free, ~5 minutes)

1. Go to https://console.firebase.google.com → **Create a project** (Analytics not needed).
2. In the left menu: **Build → Realtime Database → Create Database**. Pick a location (e.g. `europe-west1`) and start in **locked mode**.
3. Open the **Rules** tab, replace the contents with [`database.rules.json`](database.rules.json), and click **Publish**.
4. Copy the database URL shown at the top of the **Data** tab
   (looks like `https://<project>-default-rtdb.europe-west1.firebasedatabase.app`).
5. Paste it into [`config.js`](config.js):
   ```js
   window.FIREBASE_DB_URL = "https://<project>-default-rtdb.europe-west1.firebasedatabase.app";
   ```
6. Commit and push. The first visit creates the 15 empty player rows.

Until `config.js` is filled in, the page shows a "Not connected" banner and nothing is saved.

**Note:** there is no login. Anyone with the page link can view and edit the grid, so share the link with the team only.
