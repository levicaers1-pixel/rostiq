"""RostiQ brand assets, from the official brand package (assets/brand/).

    python tools/make_brand.py

Writes assets/q.svg (the Q mark next to "Rosti" in the header), the PNG app icons, favicon and
og-image.png. The Q mark geometry is the package's rostiq-icon.svg: a cyan ring, a centre node and a tail.
Team logos (e.g. assets/wordmark-light.png for Pampas) are separate and not touched.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
INDIGO, CYAN, WHITE, OFFWHITE = (30, 27, 75), (34, 211, 238), (255, 255, 255), (248, 250, 252)

# Q mark (package rostiq-logo-primary.svg): ring r=48 stroke 14, node r=9, tail (28,28)→(62,58) stroke 14, round cap.
RING_R, STROKE, NODE_R, TAIL = 48, 14, 9, ((34.3, 33.6), (62, 58))
# (The package starts the tail at (28,28), inside the ring, so its round end shows as a bump; (34.3,33.6) is
# the same line where it meets the ring's centre line.)
# Bounding box around the ring and the tail's round end, centred on the ring.
X0, Y0 = -RING_R - STROKE / 2, -RING_R - STROKE / 2
X1, Y1 = TAIL[1][0] + STROKE / 2, TAIL[1][1] + STROKE / 2

with open(os.path.join(ASSETS, "q.svg"), "w", encoding="utf-8") as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{X0:g} {Y0:g} {X1 - X0:g} {Y1 - Y0:g}">'
            f'<g fill="none" stroke="#22D3EE" stroke-width="{STROKE}"><circle r="{RING_R}"/>'
            f'<line x1="{TAIL[0][0]}" y1="{TAIL[0][1]}" x2="{TAIL[1][0]}" y2="{TAIL[1][1]}" stroke-linecap="round"/></g>'
            f'<circle r="{NODE_R}" fill="#22D3EE"/></svg>\n')


def q_mark(size, box, bg=None, color=CYAN):
    """The Q mark fitted in `box` px, centred (by its bounding box) on a size×size image."""
    ss = 4
    S = size * ss
    scale = box * ss / max(X1 - X0, Y1 - Y0)
    cx = S / 2 - (X0 + X1) / 2 * scale
    cy = S / 2 - (Y0 + Y1) / 2 * scale
    img = Image.new("RGBA", (S, S), bg + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = STROKE * scale
    r_out, r_in = (RING_R + STROKE / 2) * scale, (RING_R - STROKE / 2) * scale
    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=color)
    d.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=bg + (255,) if bg else (0, 0, 0, 0))
    (ax, ay), (bx, by) = TAIL
    p0, p1 = (cx + ax * scale, cy + ay * scale), (cx + bx * scale, cy + by * scale)
    d.line([p0, p1], fill=color, width=round(w))
    for px, py in (p0, p1):
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=color)
    n = NODE_R * scale
    d.ellipse([cx - n, cy - n, cx + n, cy + n], fill=color)
    return img.resize((size, size), Image.LANCZOS)


# App icons: cyan Q on white (the maskable one with extra margin, Android crops it).
for size, name, frac in ((512, "icon-512.png", .64), (192, "icon-192.png", .64), (512, "icon-maskable-512.png", .48),
                         (180, "apple-touch-icon.png", .64)):
    q_mark(size, size * frac, WHITE).convert("RGB").save(os.path.join(ASSETS, name), optimize=True)
q_mark(64, 60).save(os.path.join(ASSETS, "favicon.png"), optimize=True)  # transparent


def font(names, size):
    for n in names:
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, size)
    return ImageFont.load_default()


# Link preview 1200×630: the package's inverse logo on deep indigo.
W, H = 1200, 630
img = Image.new("RGB", (W, H), INDIGO)
d = ImageDraw.Draw(img)
d.rectangle([0, H - 12, W, H], fill=CYAN)
logo = Image.open(os.path.join(ASSETS, "brand", "rostiq-logo-dark.png")).convert("RGBA")
logo = logo.crop(logo.getbbox())  # trim the transparent margin
lw = 640
logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
img.paste(logo, ((W - lw) // 2, 150), logo)
for text, y, f_, col in (("Teamplanner voor sportploegen", 410, font(["segoeui.ttf", "DejaVuSans.ttf"], 44), OFFWHITE),
                         ("Beschikbaarheid  ·  Carpool  ·  Kalender  ·  WhatsApp", 480, font(["segoeui.ttf", "DejaVuSans.ttf"], 30), CYAN)):
    l, t, r, b = d.textbbox((0, 0), text, font=f_)
    d.text(((W - (r - l)) / 2 - l, y - t), text, font=f_, fill=col)
img.save(os.path.join(ASSETS, "og-image.png"), optimize=True)
print("assets written to", ASSETS)
