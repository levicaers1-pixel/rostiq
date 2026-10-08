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
# Profile photo: a small square image made in the browser (about 10 kB, at most 60 000 characters).
PHOTO = {".validate": r"newData.isString() && newData.val().length <= 60000 && "
                      r"newData.val().matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/)"}


def personal():
    """Personal details: in each team's player row, and once per account in users/{uid}/profile."""
    return {
        "phone": {".validate": "newData.isString() && newData.val().matches(/^[1-9][0-9]{7,14}$/)"},
        "email": {".validate": "newData.isString() && newData.val().length <= 100 && newData.val().matches(/^[^ @]+@[^ @]+\\.[^ @]+$/)"},  # rules regex has no \s
        "fed": {".validate": "newData.isString() && newData.val().matches(/^[A-Za-z0-9 .\\/-]{1,20}$/)"},
        "gemeente": s(60),
        "geo": {".validate": "newData.hasChildren(['lat', 'lon', 'label'])", **LATLON, "label": s(120), "$other": NO},
        "photo": PHOTO,
    }


def player_rules(owner):
    """Rules for one player row; `owner` = who may edit their own fields."""
    own = lambda extra: {".write": owner, **extra}
    return {
        "uid": {".validate": "newData.isString()"},
        "order": {".validate": "newData.isNumber()"},
        "name": own(s(60)),
        **{k: own(v) for k, v in personal().items()},
        # The team's own extra fields (Admin → Player fields): c1…c4.
        "extra": own({"$c": {".validate": "$c.matches(/^c[1-4]$/) && newData.isString() && newData.val().length <= 60"}}),
        "avail": own({"$date": {".validate": "newData.val() === 'yes' || newData.val() === 'maybe' || newData.val() === 'no'"}}),
        "$other": NO,
    }


def settings_rules():
    return {
        "minPlayers": num(1, 50),
        "seasonName": s(60, 1),
        "scheduleInDb": {".validate": "newData.isBoolean()"},
        "waGroup": {".validate": "newData.isString() && newData.val().matches(/^https:\\/\\/chat\\.whatsapp\\.com\\/[A-Za-z0-9]{10,40}$/)"},
        # Sport and player fields (Admin → Player fields).
        "sport": {".validate": "newData.isString() && newData.val().matches(/^(golf|tennis|padel|hockey|football|basketball|volleyball|other)$/)"},
        "fedOff": {".validate": "newData.isBoolean()"},
        "fedLabel": s(40, 1),
        "fields": {"$c": {".validate": "$c.matches(/^c[1-4]$/) && newData.isString() && newData.val().length >= 1 && newData.val().length <= 30"}},
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
    # Starting a team: the only admin and member a self-starter can add is themselves.
    "admins": {"$uid": {".read": "auth != null && auth.uid === $uid",
                        ".validate": f"newData.val() === true && ({PA} || $uid === auth.uid || root.child('teams').child($tid).exists())"}},
    "members": {"$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": TA,
        ".validate": "newData.isString() && newData.parent().parent().child('players').child(newData.val()).child('uid').val() === $uid"
                     f" && ({PA} || $uid === auth.uid || root.child('teams').child($tid).exists())"}},
    "requests": request_rules(f"auth != null && (auth.uid === $uid || {TA})", " && newData.parent().parent().child('info').exists()", TA),  # the team (also when created in the same write)
    "initialized": {".write": TA},
    "players": {"$pid": {".write": TA, **player_rules(OWNER)}},
    "settings": {".write": TA, **settings_rules()},
    "schedule": {".write": TA, **schedule_rules()},
    "matches": {".write": TA, **matches_rules()},
    "carpool": carpool_rules(f"{TA} || {OWNER}", MYPID),
    # Who started the team (self-service) – written once, at creation.
    "meta": {
        "createdBy": {".validate": "newData.isString()"},
        "createdAt": {".validate": "newData.isNumber()"},
        "creatorName": s(60),
        "creatorEmail": s(100),
        "code": s(30, 1),
        "$other": NO,
    },
    "$other": NO,
}

# ---- Self-service: anyone signed in (verified email) may START a new team, with a pilot code unless signup is open ----
# One atomic write creates the team with the creator as its only admin and first player, their "my teams" entry,
# their "created" entry and (with a code) one use less of that code. Max 3 self-started teams per person.
NEW = "newData.parent().parent()"  # the database as it will be after the write
CODE = "newData.child('meta').child('code').val()"
SELF_CREATE = (
    "auth != null && auth.token.email_verified === true && !data.exists()"
    " && newData.child('admins').child(auth.uid).val() === true && newData.child('info').child('brand').isString()"
    " && newData.child('meta').child('createdBy').val() === auth.uid && newData.child('meta').child('createdAt').isNumber()"
    # max 3 per person: the new team takes one of three slots that was still free
    + "".join([" && (" + " || ".join(
        f"(!root.child('users').child(auth.uid).child('created').child('s{i}').exists()"
        f" && {NEW}.child('users').child(auth.uid).child('created').child('s{i}').val() === $tid)" for i in (1, 2, 3)) + ")"]) +
    " && (root.child('signup').child('open').val() === true"
    f"     || ({CODE} !== null && root.child('signupCodes').child({CODE}).child('uses').val() > 0"
    f"         && {NEW}.child('signupCodes').child({CODE}).child('uses').val() === root.child('signupCodes').child({CODE}).child('uses').val() - 1))"
)
team[".write"] = f"{PA} || ({SELF_CREATE})"

signup = {
    # Platform switch: true = anyone may start a team without a code.
    "open": {".read": "auth != null", ".write": PA, ".validate": "newData.isBoolean()"},
    "$other": NO,
}
signup_codes = {
    ".read": PA,  # the list is yours; a single code can be read by whoever knows it
    "$code": {
        ".read": "auth != null",
        ".write": f"{PA} || (auth != null && data.exists() && newData.exists())",
        ".validate": f"$code.matches(/^[A-Z0-9-]{{3,30}}$/) && newData.hasChildren(['uses'])"
                     f" && ({PA} || (newData.child('uses').val() === data.child('uses').val() - 1"
                     " && newData.child('note').val() === data.child('note').val()))",
        "uses": num(0, 1000),
        "note": s(60),
        "$other": NO,
    },
}

users = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": PA,
    # Index of my teams: users/{uid}/teams/{teamId} = playerId (mirrors teams/{t}/members/{uid}).
    "teams": {"$tid": {
        # PA, the team admin, or the person themselves (e.g. when starting a team); the value must match members/{uid}.
        ".write": f"{PA} || (auth != null && (auth.uid === $uid || root.child('teams').child($tid).child('admins').child(auth.uid).val() === true))",
        ".validate": "newData.isString() && newData.val() === newData.parent().parent().parent().parent().child('teams').child($tid).child('members').child($uid).val()"}},
    # My personal details, shared by all my teams (each team keeps a copy in my player row).
    "profile": {".write": "auth != null && auth.uid === $uid", **personal(), "$other": NO},
    # Teams I started myself (max 3, checked when creating). Only added, never removed by the user.
    "created": {"$slot": {".write": "auth != null && auth.uid === $uid && newData.exists() && !data.exists()",
                          ".validate": "$slot.matches(/^s[1-3]$/) && newData.isString() && newData.parent().parent().parent().parent().child('teams').child(newData.val()).child('meta').child('createdBy').val() === $uid"}},
    "$other": NO,
}}

# ---- Feedback from users to the RostiQ admin: anyone signed in may send, only the RostiQ admin reads ----
# Max one message per minute per person: each message must stamp feedbackLast/{uid} with the server time in the
# same write, and that stamp may only move on when the previous one is at least 60 s old.
feedback = {
    ".read": PA,
    "$id": {
        ".write": f"{PA} || (auth != null && !data.exists() && newData.child('uid').val() === auth.uid"
                  " && newData.parent().parent().child('feedbackLast').child(auth.uid).val() === now)",
        ".validate": "$id.matches(/^[a-z0-9]{8,30}$/) && newData.hasChildren(['uid', 'type', 'text', 'at', 'status'])",
        "uid": {".validate": "newData.isString()"},
        "type": {".validate": "newData.val() === 'idea' || newData.val() === 'bug' || newData.val() === 'praise'"},
        "text": s(1000, 1),
        "at": {".validate": "newData.isNumber()"},
        "status": {".validate": f"newData.val() === 'new' || ({PA} && (newData.val() === 'seen' || newData.val() === 'done'))"},
        "contact": {".validate": "newData.isBoolean()"},
        "email": {".validate": f"newData.isString() && (newData.val() === auth.token.email || {PA})"},
        "name": s(60), "team": s(40), "page": s(40), "device": s(120), "lang": s(5), "version": s(20),
        "$other": NO,
    },
}
feedback_last = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    ".validate": "newData.isNumber() && newData.val() === now && (!data.exists() || now - data.val() >= 60000)",
}}

final = {"rules": {"teams": {".read": PA, "$tid": team}, "users": users, "signup": signup, "signupCodes": signup_codes,
                   "feedback": feedback, "feedbackLast": feedback_last, "$other": NO}}

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
