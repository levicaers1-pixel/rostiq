"""Generate the RostiQ database rules.

    python tools/build_rules.py

Writes
  database.rules.json             final rules: every team lives under teams/{teamId}/
  database.rules.transition.json  final rules + the old single-team (Pampas) structure at the
                                  database root, so the old and the new app can run side by side
                                  while Pampas is migrated. Publish this first, the final one after.

Roles
  platform admin  the RostiQ owner(s) below: create teams, everything everywhere
  team admin      teams/{t}/admins/{uid} = true: manages one team (players, matches, settings)
  member          teams/{t}/members/{uid} = playerId: reads the team, edits own row/carpool
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATFORM_ADMINS = ["levicaers1@gmail.com"]

PA = "(auth != null && auth.token.email_verified === true && (" + " || ".join(
    f"auth.token.email === '{e}'" for e in PLATFORM_ADMINS) + "))"
T = "root.child('teams').child($tid)"
TA = f"({PA} || (auth != null && {T}.child('admins').child(auth.uid).val() === true))"
MEMBER = f"(auth != null && {T}.child('members').child(auth.uid).exists())"
OWNER = f"(auth != null && {T}.child('players').child($pid).child('uid').val() === auth.uid)"
MYPID = f"{T}.child('members').child(auth.uid).val()"


def s(maxlen, minlen=0):
    v = "newData.isString()"
    if minlen:
        v += f" && newData.val().length >= {minlen}"
    return {".validate": f"{v} && newData.val().length <= {maxlen}"}


def num(lo, hi):
    return {".validate": f"newData.isNumber() && newData.val() >= {lo} && newData.val() <= {hi}"}


NO = {".validate": False}
HHMM = {".validate": "newData.isString() && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)"}
LATLON = {"lat": num(-90, 90), "lon": num(-180, 180)}
COLOR = {".validate": "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)"}
PALETTE = {"$var": {".validate": "$var.matches(/^--[a-z-]{2,20}$/) && newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)"}}
# Logo: an image stored inline (scaled down in the browser, max ~150 kB), or a file of this site (Pampas).
LOGO = (r"newData.isString() && newData.val().length <= 150000 && ("
        r"newData.val().matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/) || "
        r"newData.val().matches(/^assets\/[a-z0-9-]+\.(png|webp|svg)$/))")


def personal():
    """Personal details: in each team's player row, and once per account in users/{uid}/profile."""
    return {
        "phone": {".validate": "newData.isString() && newData.val().matches(/^[1-9][0-9]{7,14}$/)"},
        "email": {".validate": "newData.isString() && newData.val().length <= 100 && newData.val().matches(/^[^ @]+@[^ @]+\\.[^ @]+$/)"},  # rules regex has no \s
        "fed": {".validate": "newData.isString() && newData.val().matches(/^[A-Za-z0-9 .\\/-]{1,20}$/)"},
        "gemeente": s(60),
        "geo": {".validate": "newData.hasChildren(['lat', 'lon', 'label'])", **LATLON, "label": s(120), "$other": NO},
    }


def player_rules(owner):
    """Rules for one player row; `owner` = who may edit their own fields."""
    own = lambda extra: {".write": owner, **extra}
    return {
        "uid": {".validate": "newData.isString()"},
        "order": {".validate": "newData.isNumber()"},
        "name": own(s(60)),
        **{k: own(v) for k, v in personal().items()},
        "avail": own({"$date": {".validate": "newData.val() === 'yes' || newData.val() === 'maybe' || newData.val() === 'no'"}}),
        "$other": NO,
    }


def settings_rules():
    return {
        "minPlayers": num(1, 50),
        "seasonName": s(60, 1),
        "scheduleInDb": {".validate": "newData.isBoolean()"},
        "waGroup": {".validate": "newData.isString() && newData.val().matches(/^https:\\/\\/chat\\.whatsapp\\.com\\/[A-Za-z0-9]{10,40}$/)"},
        "$other": NO,
    }


def schedule_rules():
    return {"$date": {
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.hasChild('opp')",
        "opp": s(60, 1), "final": {".validate": "newData.isBoolean()"}, "$other": NO}}


def matches_rules():
    return {"$date": {
        "start": HHMM, "end": HHMM,
        "venue": {".validate": "newData.hasChild('name')", "name": s(120), "address": s(160), **LATLON, "$other": NO},
        "meet": s(120), "info": s(200), "$other": NO}}


def carpool_rules(write, mypid):
    return {"$date": {"$pid": {
        ".write": write,
        ".validate": "newData.hasChild('role')",
        "role": {".validate": "newData.val() === 'driver' || newData.val() === 'rider'"},
        "seats": num(1, 8),
        "note": s(120),
        # A driver may put a rider in their own car, or take them out again.
        "with": {".write": f"auth != null && {mypid} != null && (newData.val() === {mypid} || (!newData.exists() && data.val() === {mypid}))",
                 **s(40)},
        "$other": NO}}}


def request_rules(write, extra_validate="", admin=None):
    # The requester's own email; an admin may also write it (e.g. when moving requests during migration).
    email_ok = "newData.val() === auth.token.email" + (f" || {admin}" if admin else "")
    return {"$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": write,
        ".validate": "newData.hasChildren(['email', 'name', 'at'])" + extra_validate,
        "email": {".validate": f"newData.isString() && ({email_ok})"},
        "name": s(60, 1),
        "at": {".validate": "newData.isNumber()"},
        # The requester's personal details, so the admin's approval fills them in right away.
        "profile": {**personal(), "$other": NO},
        "$other": NO}}


team = {
    ".read": f"{TA} || {MEMBER}",
    ".write": PA,
    ".validate": "$tid.matches(/^[a-z0-9][a-z0-9-]{1,39}$/)",
    # Name, logo, colours…: readable by anyone signed in (shown on the 'waiting for approval' screen).
    # The team admin may change the branding fields (Admin → Branding); the rest is the RostiQ admin's.
    "info": {
        ".read": "auth != null",
        ".validate": "newData.hasChild('brand')",
        "brand": {".write": TA, **s(60, 1)}, "shortName": {".write": TA, **s(60)},
        "calendarLabel": {".write": TA, **s(60)}, "adminName": {".write": TA, **s(60)},
        "season": s(60),
        "logo": {".write": TA, ".validate": LOGO},
        "font": {".write": TA, ".validate": "newData.val() === 'serif' || newData.val() === 'sans'"},
        "teamSize": num(0, 60), "minPlayers": num(1, 50),
        # Only "#rrggbb" colours under "--css-variable" names: nothing else can reach the page's style sheet.
        "colors": {".write": TA, "main": COLOR, "highlight": COLOR, "light": PALETTE, "dark": PALETTE, "$other": NO},
        "events": {},
        "$other": NO,
    },
    "admins": {"$uid": {".read": "auth != null && auth.uid === $uid", ".validate": "newData.val() === true"}},
    "members": {"$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": TA,
        ".validate": "newData.isString() && newData.parent().parent().child('players').child(newData.val()).child('uid').val() === $uid"}},
    "requests": request_rules(f"auth != null && (auth.uid === $uid || {TA})", " && newData.parent().parent().child('info').exists()", TA),  # the team (also when created in the same write)
    "initialized": {".write": TA},
    "players": {"$pid": {".write": TA, **player_rules(OWNER)}},
    "settings": {".write": TA, **settings_rules()},
    "schedule": {".write": TA, **schedule_rules()},
    "matches": {".write": TA, **matches_rules()},
    "carpool": carpool_rules(f"{TA} || {OWNER}", MYPID),
    "$other": NO,
}

users = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": PA,
    # Index of my teams: users/{uid}/teams/{teamId} = playerId (mirrors teams/{t}/members/{uid}).
    "teams": {"$tid": {
        ".write": f"{PA} || (auth != null && root.child('teams').child($tid).child('admins').child(auth.uid).val() === true)",
        ".validate": "newData.isString() && newData.val() === newData.parent().parent().parent().parent().child('teams').child($tid).child('members').child($uid).val()"}},
    # My personal details, shared by all my teams (each team keeps a copy in my player row).
    "profile": {".write": "auth != null && auth.uid === $uid", **personal(), "$other": NO},
    "$other": NO,
}}

final = {"rules": {"teams": {".read": PA, "$tid": team}, "users": users, "$other": NO}}

# ---- Transition: also allow the old single-team structure at the root (Pampas, pre-migration) ----
L_OWNER = "(auth != null && root.child('players').child($pid).child('uid').val() === auth.uid)"
L_MYPID = "root.child('users').child(auth.uid).child('pid').val()"
legacy = {
    # Only accounts linked in the OLD structure (users/{uid}/pid) may read the old root data.
    ".read": f"auth != null && (root.child('users').child(auth.uid).child('pid').exists() || {PA})",
    "initialized": {".write": PA},
    "requests": request_rules(f"auth != null && (auth.uid === $uid || {PA})"),
    "players": {"$pid": {".write": PA, **player_rules(L_OWNER)}},
    "settings": {".write": PA, **settings_rules()},
    "schedule": {".write": PA, **schedule_rules()},
    "matches": {".write": PA, **matches_rules()},
    "carpool": carpool_rules(f"{PA} || {L_OWNER}", L_MYPID),
}
transition = json.loads(json.dumps(final))
transition["rules"] = {**legacy, **transition["rules"]}
transition["rules"]["users"]["$uid"]["pid"] = {
    ".validate": "newData.isString() && newData.parent().parent().parent().child('players').child(newData.val()).child('uid').val() === $uid"}

for name, data in (("database.rules.json", final), ("database.rules.transition.json", transition)):
    with open(os.path.join(ROOT, name), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote", name)
