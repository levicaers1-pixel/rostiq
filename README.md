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

### Match details (admin)

On the Availability page the admin sees ✏️ next to each match: set start/end time, the venue
(searched with Photon / OpenStreetMap, or typed in), a meeting time/place and extra info.
These show up on both pages, in reminders and in the calendar (.ics) files; the Carpool page
also shows each player's distance to the venue.

### Languages

Dutch and English (NL | EN switch in the header; default follows the browser language).
All interface texts live in `i18n.js`.

### Admin tab (admin only)

Players & accounts (add/remove, login links, phone/gemeente status), settings (season name,
minimum players, WhatsApp group link), matches (add/remove dates and opponents; ✏️ opens the
time/venue window), a backup download, and "new season" (backup, then clear answers, carpools
and matches while keeping players and settings).

The built-in schedule in `common.js` (`DEFAULT_EVENTS`) is only used until the admin edits
matches on the Admin page; from then on the schedule lives in the database.

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
