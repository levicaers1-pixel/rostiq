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
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATFORM_ADMINS = ["levicaers1@gmail.com"]

# Signed in with a verified email address (Google, or the email sign-in link).
VERIFIED = "auth != null && auth.token.email_verified === true"
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
DATE = {".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"}
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
        # Holidays: away from f to t (dates); my teams' matches in that period get "no".
        "away": {"$id": {".validate": "$id.matches(/^[0-9a-z]{6,20}$/) && newData.hasChildren(['f', 't']) && newData.child('t').val() >= newData.child('f').val()",
                         "f": DATE, "t": DATE, "n": s(60), "$other": NO}},
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
        # Trainings: coming or not (tr/<date>).
        "tr": own({"$date": {".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && (newData.val() === 'yes' || newData.val() === 'no')"}}),
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
        "autoRemind": {".validate": "newData.isBoolean()"},
        "wx": {".validate": "newData.isBoolean()"},  # weather warnings on / off (missing: on for outdoor sports)
        # Weekly trainings: slots/<id> = { wd: weekday 0 (Sunday) … 6, start, end, venue }, the season (from / to), and
        # optOut = everyone counts as coming unless they say no.
        "train": {
            "slots": {"$id": {".validate": "$id.matches(/^t[0-9]{1,2}$/) && newData.hasChildren(['wd', 'start'])",
                              "wd": num(0, 6), "start": HHMM, "end": HHMM,
                              "venue": {".validate": "newData.hasChild('name')", "name": s(120), "address": s(160), **LATLON, "$other": NO},
                              "$other": NO}},
            "from": DATE, "to": DATE, "optOut": {".validate": "newData.isBoolean()"},
            "$other": NO},
        "quickLinks": {".validate": "newData.isBoolean()"},
        # How this team picks a line-up (Selection window): f squad | order | pairs, n starters / players / pairs,
        # b bench places, pos positions on, cap captain on, by sort by handicap | ranking | none. Missing: the sport's default.
        "sel": {"f": {".validate": "newData.val() === 'squad' || newData.val() === 'order' || newData.val() === 'pairs'"},
                "n": num(1, 30), "b": num(0, 20),
                "pos": {".validate": "newData.isBoolean()"}, "cap": {".validate": "newData.isBoolean()"},
                "auto": {".validate": "newData.isBoolean()"},  # false = a reserve doesn't step in by itself (admins are told)
                "by": {".validate": "newData.val() === 'handicap' || newData.val() === 'ranking' || newData.val() === 'none'"},
                "$other": NO},  # false = personal answer links don't work for this team  # false = no automatic push reminders for this team
        "$other": NO,
    }


def schedule_rules():
    return {"$date": {
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.hasChild('opp')",
        "opp": s(60, 1), "final": {".validate": "newData.isBoolean()"},
        "home": {".validate": "newData.isBoolean()"},  # true = home match, false = away
        "cancelled": {".validate": "newData.val() === true"},  # called off (kept in the list, struck through)
        "moved": {".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"},  # moved here from that date
        "$other": NO}}


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
        ".read": VERIFIED,
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
                        # A team admin may make a linked member admin too; anyone may step down (e.g. when deleting their account).
                        ".write": f"({TA} && newData.val() === true && root.child('teams').child($tid).child('members').child($uid).exists())"
                                  " || (auth != null && auth.uid === $uid && !newData.exists())",
                        ".validate": f"newData.val() === true && ({PA} || $uid === auth.uid || root.child('teams').child($tid).exists())"}},
    "members": {"$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": f"{TA} || (auth != null && auth.uid === $uid && !newData.exists())",  # leaving: only yourself
        ".validate": "newData.isString() && newData.parent().parent().child('players').child(newData.val()).child('uid').val() === $uid"
                     f" && ({PA} || $uid === auth.uid || root.child('teams').child($tid).exists())"}},
    # Old place of access requests (inside the team, so every member could read them): only emptying it is allowed now.
    # They live in requests/<team>/<uid> (below); the daily job moves any old ones over.
    "requests": {"$uid": {".read": "auth != null && auth.uid === $uid", ".write": f"auth != null && (auth.uid === $uid || {TA}) && !newData.exists()"}},
    "initialized": {".write": TA},
    "players": {"$pid": {".write": f"{TA} || ({OWNER} && !newData.exists())", **player_rules(OWNER)}},  # own row: remove only
    "settings": {".write": TA, **settings_rules()},
    "schedule": {".write": TA, **schedule_rules()},
    "matches": {".write": TA, **matches_rules()},
    # Selection per match (admins): p/<player> = "s" selected | "r" reserve; pub = shown to the team;
    # o/<player> = playing order or reserve order, pos/<player> = position (squad sports) or bench, pair/<player> = pair
    # number (padel, doubles), cap = the captain's player id.
    "selection": {".write": TA, "$date": {
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)",
        "p": {"$pid": {".validate": "newData.val() === 's' || newData.val() === 'r'"}},
        "o": {"$pid": num(1, 60)},
        "pos": {"$pid": {".validate": "newData.val() === 'gk' || newData.val() === 'def' || newData.val() === 'mid' || newData.val() === 'fwd' || newData.val() === 'bench'"}},
        "pair": {"$pid": num(1, 10)},
        "cap": {".validate": "newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]{1,40}$/)"},
        # The last change by the dropout function (who left, who stepped in); the admin's own save simply leaves it out.
        "chg": {"out": {".validate": "newData.isString()"}, "in": {".validate": "newData.isString()"}, "at": {".validate": "newData.isNumber()"}, "$other": NO},
        "pub": {".validate": "newData.isBoolean()"}, "at": {".validate": "newData.isNumber()"},
        "$other": NO}},
    "carpool": carpool_rules(f"{TA} || {OWNER}", MYPID),
    # Who an admin's reminder reached, per match: written by the reminder function only (Admin SDK); admins may clear it
    # (a match removed, a new season). p/<player> = {at, v: "push" | "mail" | "none"}.
    "reminded": {".write": f"{TA} && !newData.exists()", "$date": {
        ".write": f"{TA} && !newData.exists()",
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)",
        "at": {".validate": "newData.isNumber()"}, "by": {".validate": "newData.isString()"},
        "p": {"$pid": {"at": {".validate": "newData.isNumber()"},
                       "v": {".validate": "newData.val() === 'push' || newData.val() === 'mail' || newData.val() === 'none'"}, "$other": NO}},
        "$other": NO}},
    # One training called off (off = true) or with a note for that day (trainings/<date>).
    "trainings": {".write": TA, "$date": {
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)",
        "off": {".validate": "newData.val() === true"}, "note": s(120), "$other": NO}},
    # Announcements from the admins, shown at the top of the team page (news/<id>; "until" = last day shown).
    "news": {".write": TA, "$id": {
        ".validate": "$id.matches(/^[0-9a-z]{10,24}$/) && newData.hasChildren(['text', 'by', 'at'])",
        "text": s(500, 1), "by": {".validate": "newData.isString()"}, "name": s(40), "at": {".validate": "newData.isNumber()"},
        "until": {".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"},
        "mailed": num(0, 500),  # how many players got it by email (written by the function)
        "$other": NO}},
    # Who was asked to complete their details, and how (written by the function only; admins may clear it).
    "profileAsked": {".write": f"{TA} && !newData.exists()", "$pid": {
        ".write": f"{TA} && !newData.exists()",
        "at": {".validate": "newData.isNumber()"},
        "v": {".validate": "newData.val() === 'push' || newData.val() === 'mail' || newData.val() === 'none'"}, "$other": NO}},
    "profileAskedAt": {".write": f"{TA} && !newData.exists()", ".validate": "newData.isNumber()"},
    # Who started the team (self-service): written once, at creation. Only the account id and date: the creator's
    # name, email and pilot code live in teamCreators/<team> (below), which members can't read.
    "meta": {
        "createdBy": {".validate": "newData.isString()"},
        "createdAt": {".validate": "newData.isNumber()"},
        # Old place of name, email and code: only removing them is allowed (the job moves them to teamCreators).
        "creatorName": {".write": "auth != null && data.parent().child('createdBy').val() === auth.uid && !newData.exists()", **NO},
        "creatorEmail": {".write": "auth != null && data.parent().child('createdBy').val() === auth.uid && !newData.exists()", **NO},
        "code": NO,
        "$other": NO,
    },
    "$other": NO,
}

# ---- Self-service: anyone signed in (verified email) may START a new team, with a pilot code unless signup is open ----
# One atomic write creates the team with the creator as its only admin and first player, their "my teams" entry,
# their "created" entry and (with a code) one use less of that code. Max 3 self-started teams per person.
NEW = "newData.parent().parent()"  # the database as it will be after the write
CODE = "newData.parent().parent().child('teamCreators').child($tid).child('c').val()"
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
    "open": {".read": VERIFIED, ".write": PA, ".validate": "newData.isBoolean()"},
    "$other": NO,
}
signup_codes = {
    ".read": PA,  # the list is yours; a single code can be read by whoever knows it
    "$code": {
        # Whoever knows a code may read how many uses it has left, only that, not the note.
        ".write": f"{PA} || (auth != null && data.exists() && newData.exists())",
        ".validate": f"$code.matches(/^[A-Z0-9-]{{3,30}}$/) && newData.hasChildren(['uses'])"
                     f" && ({PA} || (newData.child('uses').val() === data.child('uses').val() - 1"
                     " && newData.child('note').val() === data.child('note').val()))",
        "uses": {".read": VERIFIED, **num(0, 1000)},
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
    "profile": {".write": "auth != null && auth.uid === $uid", **personal(),
                # Sport details, the same in all my teams of that sport: sports/<sport>/<kind>.
                "sports": {"$sport": {
                    ".validate": "$sport.matches(/^(golf|tennis|padel|hockey|football|basketball|volleyball|other)$/)",
                    "handicap": s(60), "ranking": s(60), "number": s(60), "position": s(60),
                    "fed": personal()["fed"],
                    "$other": NO}},
                "$other": NO},
    # Ids of my own feedback messages, so I can read or delete them later (Privacy → my data).
    "feedback": {"$id": {".write": "auth != null && auth.uid === $uid",
                         ".validate": "$id.matches(/^[a-z0-9]{8,30}$/) && newData.val() === true"}},
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
        ".read": "auth != null && data.child('uid').val() === auth.uid",  # your own messages (download / delete)
        ".write": f"{PA} || (auth != null && !data.exists() && newData.child('uid').val() === auth.uid"
                  " && newData.parent().parent().child('feedbackLast').child(auth.uid).val() === now)"
                  " || (auth != null && data.child('uid').val() === auth.uid && !newData.exists())",
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

# ---- Last seen per player, only for the team's admins (outside the team, because members can read the whole team) ----
# Each member stamps only their own entry, and only with the server's clock.
last_seen = {"$tid": {
    ".read": TA,
    ".write": PA,  # e.g. when a team is deleted
    "$uid": {
        ".read": "auth != null && auth.uid === $uid",  # your own (download my data)
        ".write": "auth != null && auth.uid === $uid && root.child('teams').child($tid).child('members').child($uid).exists()",
        ".validate": "newData.isNumber() && newData.val() === now",
    },
}}

# ---- Error reports from the app: anonymous (no uid or name), at most one report per minute per person ----
errors = {
    ".read": PA,
    ".write": PA,  # clear the list
    "$id": {
        ".write": f"{PA} || ({VERIFIED} && !data.exists() && newData.parent().parent().child('errorsLast').child(auth.uid).val() === now)",
        ".validate": "$id.matches(/^[a-z0-9]{8,30}$/) && newData.hasChildren(['at', 'items'])",
        "at": {".validate": "newData.isNumber()"},
        "page": s(40), "team": s(40), "device": s(120), "lang": s(5), "version": s(20),
        "items": {"$i": {
            ".validate": "$i.matches(/^[0-9]$/) && newData.hasChildren(['msg'])",
            "msg": s(300, 1), "src": s(200), "n": num(1, 1000), "$other": NO}},
        "$other": NO,
    },
}
errors_last = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    ".validate": "newData.isNumber() && newData.val() === now && (!data.exists() || now - data.val() >= 60000)",
}}

# ---- Push notifications: each device of a person registers its messaging token here (only they can see it).
# The daily reminder job (GitHub Actions, Firebase Admin SDK) reads them; pushLog remembers what was sent.
push_tokens = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    "$device": {
        ".validate": "$device.matches(/^[a-f0-9]{20}$/) && newData.hasChildren(['token', 'at'])",
        "token": s(400, 20), "at": {".validate": "newData.isNumber()"},
        "lang": {".validate": "newData.val() === 'nl' || newData.val() === 'fr' || newData.val() === 'en'"},
        "device": s(120), "$other": NO,
    },
}}
push_log = {".read": PA, ".write": PA}

# ---- Access requests: requests/<team>/<uid>, outside the team: only the team's admins and the requester read them ----
access_requests = {"$tid": {".read": TA, **request_rules(f"auth != null && (auth.uid === $uid || {TA})",
                                                       " && root.child('teams').child($tid).child('info').exists()", TA)}}

final = {"rules": {"teams": {".read": PA, "$tid": team}, "requests": access_requests, "users": users, "signup": signup, "signupCodes": signup_codes,
                   "feedback": feedback, "feedbackLast": feedback_last, "lastSeen": last_seen,
                   "errors": errors, "errorsLast": errors_last, "pushTokens": push_tokens, "pushLog": push_log, "$other": NO}}


def verified_only(node):
    """Every 'signed in' check becomes 'signed in with a verified email' (Google or the email link). Anonymous
    sessions exist only for personal answer links and get nothing but the narrow rules added below."""
    txt = re.sub(r"auth != null(?! && auth\.token\.email_verified === true)", "auth != null && auth.token.email_verified === true", json.dumps(node))
    return json.loads(txt)


final = verified_only(final)

# ---- Personal answer links (app.rostiq.be/a/?k=…): answer without an account ----
# A team admin creates a random key per player: quickKeys/<key> = {t: team, p: player}. The answer page signs in
# anonymously and binds that session to the key (quickSessions/<uid>). Such a session may only read the team's
# name, matches, minimum and answers, its own player's name, and set that player's answer for a scheduled match.
# Resetting or removing the key ends it at once; a team can switch links off (settings.quickLinks = false).
QS = "root.child('quickSessions').child(auth.uid)"
QK = f"root.child('quickKeys').child({QS}.child('k').val())"
QUICK_TEAM = (f"(auth != null && {QS}.child('k').isString() && {QK}.child('t').val() === $tid"
              " && root.child('teams').child($tid).child('settings').child('quickLinks').val() !== false)")
QUICK_PLAYER = (f"({QUICK_TEAM} && {QK}.child('p').val() === $pid"
                " && root.child('teams').child($tid).child('players').child($pid).child('name').exists())")
TA_OF = lambda tid: f"root.child('teams').child({tid}).child('admins').child(auth.uid).val() === true"

t = final["rules"]["teams"]["$tid"]
t["info"][".read"] = f"({t['info']['.read']}) || {QUICK_TEAM}"
t["schedule"][".read"] = QUICK_TEAM
t["matches"][".read"] = QUICK_TEAM
t["members"][".read"] = QUICK_TEAM  # which players have an account (ids only): for the "9/11" count
for k in ("minPlayers", "seasonName"):
    t["settings"][k][".read"] = QUICK_TEAM
pl = t["players"]["$pid"]
pl["name"][".read"] = QUICK_PLAYER
pl["avail"][".read"] = QUICK_TEAM
pl["avail"]["$date"][".write"] = f"{QUICK_PLAYER} && root.child('teams').child($tid).child('schedule').child($date).exists()"

final["rules"]["quickKeys"] = {"$key": {
    ".read": "auth != null",  # knowing the key is the permission; the list itself can't be read
    ".write": f"{PA} || ({VERIFIED} && ((data.exists() && data.child('t').isString() && {TA_OF("data.child('t').val()")}"
              " && (!newData.exists() || newData.child('t').val() === data.child('t').val()))"
              f" || (!data.exists() && newData.child('t').isString() && {TA_OF("newData.child('t').val()")})))",
    ".validate": "$key.matches(/^[A-Za-z0-9_-]{22}$/) && newData.hasChildren(['t', 'p', 'at'])",
    "t": {".validate": "newData.isString()"}, "p": {".validate": "newData.isString()"}, "at": {".validate": "newData.isNumber()"},
    "$other": NO,
}}
final["rules"]["quickIndex"] = {"$tid": {  # per team: player -> key, for the admin's "personal link" buttons
    ".read": f"{PA} || ({VERIFIED} && {TA_OF('$tid')})",
    ".write": f"{PA} || ({VERIFIED} && {TA_OF('$tid')})",
    "$pid": {".validate": "newData.isString() && newData.val().length === 22"},
}}
final["rules"]["quickSessions"] = {"$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    ".validate": "newData.hasChildren(['k', 't', 'p']) && newData.child('k').isString()"
                 " && root.child('quickKeys').child(newData.child('k').val()).child('t').val() === newData.child('t').val()"
                 " && root.child('quickKeys').child(newData.child('k').val()).child('p').val() === newData.child('p').val()",
    "k": {".validate": "newData.isString() && newData.val().length === 22"},
    "t": {".validate": "newData.isString()"}, "p": {".validate": "newData.isString()"},
    "$other": NO,
}}
# ---- Calendar links: calKeys/<key> = {t: team, p: player, at, l: language, h: hide "no"}, calIndex/<team>/<player> = key ----
# A read-only, personal calendar feed (functions/: GET /cal/<key>.ics, read with the Admin SDK). The player makes,
# changes and resets their own link; a team admin may do it for any player of the team. Nobody can list the keys.
def owns_cal(node):  # node: "data" (existing link) or "newData" (new link)
    t, p = f"{node}.child('t').val()", f"{node}.child('p').val()"
    return f"({TA_OF(t)} || root.child('teams').child({t}).child('members').child(auth.uid).val() === {p})"
final["rules"]["calKeys"] = {"$key": {
    ".read": f"{PA} || ({VERIFIED} && data.child('t').isString() && {owns_cal('data')})",
    ".write": f"{PA} || ({VERIFIED} && ((!data.exists() && newData.child('t').isString() && {owns_cal('newData')})"
              f" || (data.exists() && data.child('t').isString() && {owns_cal('data')}"
              " && (!newData.exists() || (newData.child('t').val() === data.child('t').val() && newData.child('p').val() === data.child('p').val())))))",
    ".validate": "$key.matches(/^[A-Za-z0-9_-]{22}$/) && newData.hasChildren(['t', 'p', 'at'])"
                 " && newData.parent().parent().child('teams').child(newData.child('t').val()).child('players').child(newData.child('p').val()).child('name').exists()",
    "t": {".validate": "newData.isString()"}, "p": {".validate": "newData.isString()"}, "at": {".validate": "newData.isNumber()"},
    "l": {".validate": "newData.val() === 'nl' || newData.val() === 'fr' || newData.val() === 'en'"},
    "h": {".validate": "newData.isBoolean()"},
    "$other": NO,
}}
CAL_MINE = f"({TA_OF('$tid')} || root.child('teams').child($tid).child('members').child(auth.uid).val() === $pid)"
final["rules"]["calIndex"] = {"$tid": {"$pid": {
    ".read": f"{PA} || ({VERIFIED} && {CAL_MINE})",
    ".write": f"{PA} || ({VERIFIED} && {CAL_MINE})",
    ".validate": "newData.isString() && newData.val().length === 22"
                 " && newData.parent().parent().parent().child('calKeys').child(newData.val()).child('t').val() === $tid"
                 " && newData.parent().parent().parent().child('calKeys').child(newData.val()).child('p').val() === $pid",
}}}

# ---- Calendar invitations by email: inviteSubs/<team>/<player> = {e: email, l: lang, at} ----
# Only the player themself switches them on, and only to their own verified login email (no one can sign up someone
# else's address). Admins may switch them off. inviteLog (what was sent) is for the job only: no client rules.
INV_ME = "root.child('teams').child($tid).child('members').child(auth.uid).val() === $pid"
final["rules"]["inviteSubs"] = {"$tid": {"$pid": {
    ".read": f"{PA} || ({VERIFIED} && ({TA_OF('$tid')} || {INV_ME}))",
    ".write": f"{PA} || ({VERIFIED} && (({INV_ME} && (!newData.exists() || newData.child('e').val() === auth.token.email))"
              f" || ({TA_OF('$tid')} && !newData.exists())))",
    ".validate": "newData.hasChildren(['e', 'l', 'at']) && root.child('teams').child($tid).child('players').child($pid).child('name').exists()",
    "e": {".validate": "newData.isString() && newData.val().length <= 100 && newData.val().matches(/^[^ @]+@[^ @]+\\.[^ @]+$/)"},
    "l": {".validate": "newData.val() === 'nl' || newData.val() === 'fr' || newData.val() === 'en'"},
    "at": {".validate": "newData.isNumber()"},
    "$other": NO,
}}}

# ---- Answer history: history/<team>/<date>/<id> = {p, f (was), a (now), by, at} ----
# Outside the team (members can read the whole team), only the team's admins read it. An entry can only be added in the
# same write as the answer it describes: "f" must be the answer before, "a" the answer after, and the answer must really
# change. Written by the player themself, an admin, or the player's personal link; "by" is the writer, "at" the server
# time. Entries can't be edited; admins (and the daily job) remove a match's history once it has been played.
H_P = "newData.child('p').val()"
H_NEW = f"newData.parent().parent().parent().parent().child('teams').child($tid).child('players').child({H_P}).child('avail').child($date)"
H_OLD = f"root.child('teams').child($tid).child('players').child({H_P}).child('avail').child($date)"
H_LINK = (f"(auth != null && {QS}.child('k').isString() && {QK}.child('t').val() === $tid && {QK}.child('p').val() === {H_P}"
          " && root.child('teams').child($tid).child('settings').child('quickLinks').val() !== false)")
ANSWER = "newData.val() === 'yes' || newData.val() === 'maybe' || newData.val() === 'no'"
final["rules"]["history"] = {"$tid": {
    ".read": f"{PA} || ({VERIFIED} && {TA_OF('$tid')})",
    "$date": {
        ".write": f"{PA} || ({VERIFIED} && {TA_OF('$tid')} && !newData.exists())",  # clean up one match at once
        ".validate": "$date.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)",
        "$id": {
            ".write": f"!data.exists() && newData.exists() && ({PA} || ({VERIFIED} && ({TA_OF('$tid')}"
                      f" || root.child('teams').child($tid).child('members').child(auth.uid).val() === {H_P})) || {H_LINK})",
            ".validate": "$id.matches(/^[0-9a-z]{10,24}$/) && newData.hasChildren(['p', 'by', 'at'])"
                         " && newData.child('by').val() === auth.uid && newData.child('at').val() === now"
                         f" && {H_NEW}.val() === newData.child('a').val() && {H_OLD}.val() === newData.child('f').val()"
                         f" && {H_OLD}.val() !== {H_NEW}.val()",
            "p": s(40, 1), "a": {".validate": ANSWER}, "f": {".validate": ANSWER},
            "by": {".validate": "newData.isString()"}, "at": {".validate": "newData.isNumber()"},
            "$other": NO,
        },
    },
}}
# ---- Match called off / moved / selection / reminder: notices/<team>/<id> = {k: "c" (cancelled) | "m" (moved) | "s" (selection)
#      | "a" (ask the players who haven't answered; p/<player> = true: only those)
#      | "p" (ask the players in p to complete their details; d: today), d: date, o: old date, by, at} ----
# An admin adds one right after marking the match in the schedule; a Cloud Function (functions/index.js) tells the team
# at once with a notification, then removes the notice. Only for a match that really is cancelled / moved, so nobody can
# make the function send something made up. Nobody reads them.
N_SCHED = "root.child('teams').child($tid).child('schedule').child(newData.child('d').val())"
final["rules"]["notices"] = {"$tid": {"$id": {
    ".write": f"!data.exists() && newData.exists() && ({PA} || ({VERIFIED} && {TA_OF('$tid')}))",
    ".validate": "$id.matches(/^[0-9a-z]{10,24}$/) && newData.hasChildren(['k', 'd', 'by', 'at'])"
                 " && newData.child('by').val() === auth.uid && newData.child('at').val() === now"
                 f" && ((newData.child('k').val() === 'c' && {N_SCHED}.child('cancelled').val() === true)"
                 f" || (newData.child('k').val() === 'm' && {N_SCHED}.child('moved').val() === newData.child('o').val())"
                 " || (newData.child('k').val() === 's' && root.child('teams').child($tid).child('selection').child(newData.child('d').val()).child('pub').val() === true)"
                 f" || (newData.child('k').val() === 'a' && {N_SCHED}.child('opp').exists() && {N_SCHED}.child('cancelled').val() !== true)"
                 " || (newData.child('k').val() === 'p' && newData.child('p').exists())"
                 " || (newData.child('k').val() === 't' && root.child('teams').child($tid).child('trainings').child(newData.child('d').val()).child('off').val() === true)"
                 " || (newData.child('k').val() === 'n' && newData.child('i').isString() && root.child('teams').child($tid).child('news').child(newData.child('i').val()).exists()))",
    "k": {".validate": "newData.val() === 'c' || newData.val() === 'm' || newData.val() === 's' || newData.val() === 'a' || newData.val() === 'p' || newData.val() === 'n' || newData.val() === 't'"},
    "d": {".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"},
    "o": {".validate": "newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)"},
    "by": {".validate": "newData.isString()"}, "at": {".validate": "newData.isNumber()"},
    "i": {".validate": "newData.parent().child('k').val() === 'n' && newData.isString()"},
    "m": {".validate": "newData.parent().child('k').val() === 'n' && newData.val() === true"},   # announcement: also by email
    "np": {".validate": "newData.parent().child('k').val() === 'n' && newData.val() === true"},  # announcement: no notification
    "p": {".validate": "newData.parent().child('k').val() === 'a' || newData.parent().child('k').val() === 'p'", "$pid": {".validate": "$pid.matches(/^[A-Za-z0-9_-]{1,40}$/) && newData.val() === true"}},
    "$other": NO,
}}}
# ---- Who has seen an announcement: newsSeen/<team>/<id>/<uid> = time. Each member marks their own; the team's admins
#      read them all (to see who hasn't read it yet) and may clear them; the daily job removes old ones. ----
final["rules"]["newsSeen"] = {"$tid": {
    ".read": f"{PA} || ({VERIFIED} && {TA_OF('$tid')})",
    "$id": {
        ".write": f"{PA} || ({VERIFIED} && {TA_OF('$tid')} && !newData.exists())",
        "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid && root.child('teams').child($tid).child('members').child($uid).exists()"
                      " && root.child('teams').child($tid).child('news').child($id).exists()",
            ".validate": "newData.isNumber()"}}}}
# ---- Who started a team: teamCreators/<team> = {n: name, e: email, c: pilot code} ----
# Outside the team, so members don't see the creator's email. Written together with the new team (the email must be the
# creator's own); readable by the creator and the RostiQ admin; the creator may remove it (account deletion).
CREATOR_NOW = "root.child('teams').child($tid).child('meta').child('createdBy').val() === auth.uid"
CREATOR_NEW = ("!root.child('teams').child($tid).exists()"
               " && newData.parent().parent().child('teams').child($tid).child('meta').child('createdBy').val() === auth.uid")
final["rules"]["teamCreators"] = {"$tid": {
    ".read": f"{PA} || (auth != null && {CREATOR_NOW})",
    ".write": f"{PA} || ({VERIFIED} && ((!data.exists() && {CREATOR_NEW}) || (data.exists() && !newData.exists() && {CREATOR_NOW})))",
    ".validate": f"{PA} || newData.child('e').val() === auth.token.email",
    "n": s(60), "e": s(100), "c": s(30, 1),
    "$other": NO,
}}
final["rules"]["$other"] = final["rules"].pop("$other")  # keep the catch-all last

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
