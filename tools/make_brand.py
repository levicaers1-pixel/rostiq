"""Rostiq app icons and link-preview image (green & cream).

    python tools/make_brand.py

Team logos (e.g. assets/wordmark-light.png for Pampas) are separate and not touched.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
GREEN, CREAM, BEIGE = (31, 58, 46), (244, 239, 228), (205, 185, 148)


def font(names, size):
    for n in names:
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, size)
    return ImageFont.load_default()


def centered(d, text, f, box, fill):
    l, t_, r, b = d.textbbox((0, 0), text, font=f)
    x0, y0, x1, y1 = box
    d.text((x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t_)) / 2 - t_), text, font=f, fill=fill)


# App icons: a cream serif "R" on green, with a thin beige underline.
for size, name, fill in ((512, "icon-512.png", .62), (192, "icon-192.png", .62), (512, "icon-maskable-512.png", .44),
                         (180, "apple-touch-icon.png", .62), (64, "favicon.png", .7)):
    img = Image.new("RGB", (size, size), GREEN)
    d = ImageDraw.Draw(img)
    f = font(["georgiab.ttf", "georgia.ttf", "DejaVuSerif-Bold.ttf"], int(size * fill))
    centered(d, "R", f, (0, -size * .04, size, size), CREAM)
    if size >= 180:
        w = size * (.34 if "maskable" not in name else .24)
        d.rectangle([size / 2 - w / 2, size * (.80 if "maskable" not in name else .72), size / 2 + w / 2,
                     size * (.80 if "maskable" not in name else .72) + max(3, size // 60)], fill=BEIGE)
    img.save(os.path.join(ASSETS, name), optimize=True)

# Link preview 1200x630.
W, H = 1200, 630
img = Image.new("RGB", (W, H), GREEN)
d = ImageDraw.Draw(img)
d.rectangle([0, H - 14, W, H], fill=BEIGE)
centered(d, "Rostiq", font(["georgiab.ttf", "DejaVuSerif-Bold.ttf"], 150), (0, 120, W, 330), CREAM)
centered(d, "Teamplanner voor sportploegen", font(["georgia.ttf", "DejaVuSerif.ttf"], 52), (0, 340, W, 420), CREAM)
centered(d, "Beschikbaarheid  ·  Carpool  ·  Kalender  ·  WhatsApp", font(["segoeui.ttf", "DejaVuSans.ttf"], 32), (0, 440, W, 500), BEIGE)
img.save(os.path.join(ASSETS, "og-image.png"), optimize=True)
print("assets written to", ASSETS)
