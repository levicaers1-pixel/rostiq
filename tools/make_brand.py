"""RostiQ brand assets: the R icon mark (violet → cyan), app icons and link preview.

    python tools/make_brand.py

Writes assets/mark.svg (used in the header), the PNG app icons, favicon and og-image.png.
Team logos (e.g. assets/wordmark-light.png for Pampas) are separate and not touched.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
INDIGO, CYAN, OFFWHITE, NEAR_BLACK = (30, 27, 75), (0, 212, 255), (246, 247, 250), (11, 13, 20)
G0, G1 = "#6C4BFF", "#0FC8FF"  # gradient of the mark: top-left violet → bottom-right cyan

# The mark on a 100×100 grid: a stem, a round bowl with a counter, and a diagonal leg.
OUTER = [("M", 18, 10), ("H", 58), ("A", 58, 36, 26, -90, 90), ("L", 88, 90), ("H", 60), ("L", 36, 66), ("V", 82),
         ("Q", 36, 90, 28, 90), ("H", 18), ("Q", 10, 90, 10, 82), ("V", 18), ("Q", 10, 10, 18, 10)]
COUNTER = [("M", 36, 28), ("H", 58), ("A", 58, 36, 8, -90, 90), ("H", 36)]


def svg_path(cmds):
    out, x, y = [], 0, 0
    for c in cmds:
        if c[0] in "ML":
            x, y = c[1], c[2]; out.append(f"{c[0]}{x} {y}")
        elif c[0] == "H":
            x = c[1]; out.append(f"H{x}")
        elif c[0] == "V":
            y = c[1]; out.append(f"V{y}")
        elif c[0] == "Q":
            x, y = c[3], c[4]; out.append(f"Q{c[1]} {c[2]} {x} {y}")
        elif c[0] == "A":
            cx, cy, r, a0, a1 = c[1:]
            x, y = cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1))
            out.append(f"A{r} {r} 0 0 1 {x:g} {y:g}")
    return "".join(out) + "Z"


def points(cmds, scale, ox, oy, steps=48):
    pts, x, y = [], 0, 0
    for c in cmds:
        if c[0] in "ML":
            x, y = c[1], c[2]; pts.append((x, y))
        elif c[0] == "H":
            x = c[1]; pts.append((x, y))
        elif c[0] == "V":
            y = c[1]; pts.append((x, y))
        elif c[0] == "Q":
            (qx, qy), (ex, ey) = (c[1], c[2]), (c[3], c[4])
            for i in range(1, steps + 1):
                t = i / steps
                pts.append(((1 - t) ** 2 * x + 2 * (1 - t) * t * qx + t * t * ex, (1 - t) ** 2 * y + 2 * (1 - t) * t * qy + t * t * ey))
            x, y = ex, ey
        elif c[0] == "A":
            cx, cy, r, a0, a1 = c[1:]
            for i in range(1, steps + 1):
                a = math.radians(a0 + (a1 - a0) * i / steps)
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            x, y = pts[-1]
    return [(ox + px * scale, oy + py * scale) for px, py in pts]


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mark(size, box, bg=None):
    """The mark, `box` px wide, centred on a size×size image (transparent or `bg`)."""
    ss = 4  # supersampling for smooth edges
    S, B = size * ss, box * ss
    # The mark spans x 10..88, y 10..90 of the grid: centre that.
    scale = B / 80
    ox, oy = (S - 78 * scale) / 2 - 10 * scale, (S - 80 * scale) / 2 - 10 * scale
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(points(OUTER, scale, ox, oy), fill=255)
    d.polygon(points(COUNTER, scale, ox, oy), fill=0)
    a, b = hex_rgb(G0), hex_rgb(G1)
    grad = Image.new("RGB", (S, S))
    gp = grad.load()
    for yy in range(S):
        for xx in range(0, S, 1):
            t = min(1, max(0, ((xx - ox) + (yy - oy)) / (2 * 80 * scale)))
            gp[xx, yy] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    img = Image.new("RGBA", (S, S), bg + (255,) if bg else (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    return img.resize((size, size), Image.LANCZOS)


def font(names, size):
    for n in names:
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, size)
    return ImageFont.load_default()


# Header mark (vector).
with open(os.path.join(ASSETS, "mark.svg"), "w", encoding="utf-8") as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 78 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{G0}"/><stop offset="1" stop-color="{G1}"/></linearGradient></defs>'
            f'<path fill="url(#g)" fill-rule="evenodd" d="{svg_path(OUTER)}{svg_path(COUNTER)}"/></svg>\n')

# App icons on off-white; the maskable one with extra margin (Android crops it to a circle/squircle).
for size, name, frac in ((512, "icon-512.png", .62), (192, "icon-192.png", .62), (512, "icon-maskable-512.png", .46),
                         (180, "apple-touch-icon.png", .62)):
    mark(size, size * frac, OFFWHITE).convert("RGB").save(os.path.join(ASSETS, name), optimize=True)
mark(64, 58).save(os.path.join(ASSETS, "favicon.png"), optimize=True)  # transparent

# Link preview 1200×630: mark + wordmark on deep indigo.
W, H = 1200, 630
img = Image.new("RGB", (W, H), INDIGO)
d = ImageDraw.Draw(img)
d.rectangle([0, H - 12, W, H], fill=CYAN)
m = mark(200, 200)
word = font(["segoeuib.ttf", "DejaVuSans-Bold.ttf"], 150)
l, t, r, b = d.textbbox((0, 0), "RostiQ", font=word)
total = 200 + 40 + (r - l)
x0 = (W - total) // 2
img.paste(m, (x0, 150), m)
d.text((x0 + 240 - l, 150 + (200 - (b - t)) / 2 - t), "RostiQ", font=word, fill=OFFWHITE)
sub = font(["segoeui.ttf", "DejaVuSans.ttf"], 44)
for text, y, f_, col in (("Teamplanner voor sportploegen", 410, sub, OFFWHITE),
                         ("Beschikbaarheid  ·  Carpool  ·  Kalender  ·  WhatsApp", 480, font(["segoeui.ttf", "DejaVuSans.ttf"], 30), CYAN)):
    l, t, r, b = d.textbbox((0, 0), text, font=f_)
    d.text(((W - (r - l)) / 2 - l, y - t), text, font=f_, fill=col)
img.save(os.path.join(ASSETS, "og-image.png"), optimize=True)
print("assets written to", ASSETS)
