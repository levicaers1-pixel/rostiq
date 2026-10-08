"""Rostiq: build a ready-to-deploy site for one team from teams/<id>/team.json.

    python tools/build_team.py <id>
    cd dist/<id> && npx firebase-tools deploy --project <projectId> --only hosting,database

The output in dist/<id>/ contains the shared pages and code, plus everything team-specific:
team.js, config.js (Firebase), database rules with the team's admins, app icons and a
link-preview image in the team colours, manifest and preview tags, and firebase.json for
Firebase Hosting. The Pampas site (repo root) is not touched.
"""
import json
import os
import re
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARED = ["index.html", "carpool.html", "ploeg.html", "admin.html", "common.css", "common.js", "i18n.js"]
PAGE_TITLES = {"index.html": "", "carpool.html": "Carpool · ", "ploeg.html": "", "admin.html": ""}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(names, size):
    for n in names:
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, size)
    return ImageFont.load_default()


def initials(name):
    words = [w for w in re.split(r"\s+", name.strip()) if w]
    return "".join(w[0] for w in words[:2]).upper() or "?"


def make_icons(team, out, bg, fg):
    """Square app icons with the team initials (unless the team supplies its own)."""
    text = initials(team["brand"])
    for size, name, fill in ((512, "icon-512.png", .5), (192, "icon-192.png", .5), (512, "icon-maskable-512.png", .36),
                             (180, "apple-touch-icon.png", .5), (64, "favicon.png", .55)):
        img = Image.new("RGB", (size, size), bg)
        d = ImageDraw.Draw(img)
        f = font(["georgiab.ttf", "georgia.ttf", "DejaVuSerif-Bold.ttf"], int(size * fill))
        box = d.textbbox((0, 0), text, font=f)
        d.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]), text, font=f, fill=fg)
        img.save(os.path.join(out, name), optimize=True)


def make_og(team, out, bg, fg, accent):
    """1200x630 link-preview image: team name (or logo) and season."""
    W, H = 1200, 630
    img = Image.new("RGBA", (W, H), (*bg, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, H - 14, W, H], fill=(*accent, 255))
    y = 170
    logo = team.get("logo")
    if logo and os.path.exists(os.path.join(out, logo)):
        lg = Image.open(os.path.join(out, logo)).convert("RGBA")
        w = 760
        lg = lg.resize((w, round(w * lg.height / lg.width)), Image.LANCZOS)
        img.alpha_composite(lg, ((W - w) // 2, 120))
        y = 120 + lg.height + 40
    else:
        f = font(["georgiab.ttf", "DejaVuSerif-Bold.ttf"], 96)
        tw = d.textlength(team["brand"], font=f)
        d.text(((W - tw) / 2, y), team["brand"], font=f, fill=fg)
        y += 140
    for text, size, color in ((team["season"], 60, fg), ("Beschikbaarheid  ·  Carpool  ·  Kalender", 34, accent)):
        f = font(["georgiab.ttf", "DejaVuSerif-Bold.ttf"] if size > 40 else ["segoeui.ttf", "DejaVuSans.ttf"], size)
        tw = d.textlength(text, font=f)
        d.text(((W - tw) / 2, y), text, font=f, fill=color)
        y += size + 26
    # Small product mark, bottom right.
    f = font(["segoeuib.ttf", "DejaVuSans-Bold.ttf"], 26)
    d.text((W - 40 - d.textlength("Rostiq", font=f), H - 64), "Rostiq", font=f, fill=accent)
    img.convert("RGB").save(os.path.join(out, "og-image.png"), optimize=True)


def admin_expr(admins):
    admins = [a.lower() for a in admins]
    if len(admins) == 1:
        return f"auth.token.email === '{admins[0]}' && auth.token.email_verified === true"
    either = " || ".join(f"auth.token.email === '{a}'" for a in admins)
    return f"(auth.token.email_verified === true && ({either}))"


def main(team_id):
    src = os.path.join(ROOT, "teams", team_id)
    team = json.load(open(os.path.join(src, "team.json"), encoding="utf-8"))
    fb = team.get("firebase") or {}
    project = fb.get("projectId", "")
    url = team.get("url") or (f"https://{project}.web.app/" if project else "")
    out = os.path.join(ROOT, "dist", team_id)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "assets"))

    colors = (team.get("colors") or {}).get("light", {})
    brand_rgb = hex_rgb(colors.get("--brand", "#1f3a2e"))
    cream = hex_rgb(colors.get("--brand-text", "#f4efe4"))
    accent = hex_rgb(colors.get("--pampas", "#cdb994"))

    # Logo supplied by the team (light version for the dark header), copied into assets/.
    if team.get("logo"):
        shutil.copy(os.path.join(src, team["logo"]), os.path.join(out, "assets", os.path.basename(team["logo"])))
        team["logo"] = "assets/" + os.path.basename(team["logo"])
    else:
        team["logo"] = ""

    # Icons and preview image: the team's own files if present, otherwise generated.
    make_icons(team, os.path.join(out, "assets"), brand_rgb, cream)
    make_og(team, os.path.join(out, "assets"), brand_rgb, cream, accent)
    for f in ("favicon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "og-image.png"):
        if os.path.exists(os.path.join(src, f)):
            shutil.copy(os.path.join(src, f), os.path.join(out, "assets", f))

    # team.js and config.js
    team_js = {k: team[k] for k in ("id", "brand", "logo", "shortName", "calendarLabel", "season", "admins",
                                     "adminName", "teamSize", "minPlayers", "colors", "events") if k in team}
    open(os.path.join(out, "team.js"), "w", encoding="utf-8").write(
        "// Generated by tools/build_team.py from teams/%s/team.json – edit that file, not this one.\n"
        "window.TEAM = %s;\n" % (team_id, json.dumps(team_js, ensure_ascii=False, indent=2)))
    cfg = "window.FIREBASE_DB_URL = %s;\n" % json.dumps(fb.get("databaseURL", ""))
    if fb.get("apiKey"):
        cfg += "window.FIREBASE_CONFIG = %s;\n" % json.dumps({
            "apiKey": fb["apiKey"], "authDomain": f"{project}.web.app",  # same site as the app (Firebase Hosting)
            "databaseURL": fb.get("databaseURL", ""), "projectId": project, "appId": fb.get("appId", ""),
        }, indent=2)
    open(os.path.join(out, "config.js"), "w", encoding="utf-8").write(cfg)

    # Shared pages and code, with team-specific head tags and header.
    desc = team.get("description") or f"Beschikbaarheid, kalender en carpool voor {team['season']} – {team['brand']}."
    logo_html = (f'<img class="logo" src="{team["logo"]}" alt="{team["brand"]}">' if team["logo"]
                 else f'<span class="logo-text">{team["brand"]}</span>')
    for f in SHARED:
        s = open(os.path.join(ROOT, f), encoding="utf-8").read()
        if f.endswith(".html"):
            s = re.sub(r'<img class="logo"[^>]*>', logo_html, s)
            s = s.replace('content="#1f3a2e"', f'content="{colors.get("--brand", "#1f3a2e")}"')
            s = re.sub(r'(<meta name="apple-mobile-web-app-title" content=")[^"]*', r"\g<1>" + team["shortName"], s)
            s = re.sub(r'(<meta name="description" content=")[^"]*', r"\g<1>" + desc, s)
            s = re.sub(r'(<meta property="og:description" content=")[^"]*', r"\g<1>" + desc, s)
            s = re.sub(r'(<meta property="og:site_name" content=")[^"]*', r"\g<1>" + team["brand"], s)
            s = re.sub(r'(<meta property="og:title" content=")[^"]*', r"\g<1>" + PAGE_TITLES[f] + team["season"] + " · " + team["brand"], s)
            s = re.sub(r'(<meta property="og:image:alt" content=")[^"]*', r"\g<1>" + team["brand"] + " – " + team["season"], s)
            s = re.sub(r'(<meta property="og:url" content=")[^"]*', r"\g<1>" + url + ("" if f == "index.html" else f), s)
            s = re.sub(r'(<meta property="og:image" content=")[^"]*', r"\g<1>" + url + "assets/og-image.png", s)
            s = re.sub(r"(<h1 data-season>)[^<]*", r"\g<1>" + team["season"], s)
        open(os.path.join(out, f), "w", encoding="utf-8").write(s)

    manifest = json.load(open(os.path.join(ROOT, "manifest.webmanifest"), encoding="utf-8"))
    manifest.update(name=team["season"], short_name=team["shortName"], description=desc,
                    theme_color=colors.get("--brand", "#1f3a2e"), background_color=colors.get("--bg", "#f4efe4"))
    json.dump(manifest, open(os.path.join(out, "manifest.webmanifest"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # Database rules with this team's admins, and Firebase Hosting setup.
    rules = open(os.path.join(ROOT, "database.rules.template.json"), encoding="utf-8").read()
    open(os.path.join(out, "database.rules.json"), "w", encoding="utf-8").write(rules.replace("__ADMIN__", admin_expr(team["admins"])))
    json.loads(open(os.path.join(out, "database.rules.json"), encoding="utf-8").read())  # must still be valid JSON
    json.dump({"hosting": {"public": ".", "ignore": ["firebase.json", ".firebaserc", "database.rules.json", "**/.*"]},
               "database": {"rules": "database.rules.json"}},
              open(os.path.join(out, "firebase.json"), "w", encoding="utf-8"), indent=2)
    if project:
        json.dump({"projects": {"default": project}}, open(os.path.join(out, ".firebaserc"), "w", encoding="utf-8"), indent=2)

    print(f"Built dist/{team_id}/ for {team['brand']} ({team['season']})")
    if project:
        print(f"Deploy:  cd dist/{team_id} && npx firebase-tools deploy --project {project} --only hosting,database")
        print(f"Site:    {url}")
    else:
        print("No Firebase project in team.json yet: the build runs locally without login or database.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python tools/build_team.py <team-id>")
    main(sys.argv[1])
