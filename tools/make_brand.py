"""RostiQ brand assets, from the official (preferred) brand package in assets/brand/.

    python tools/make_brand.py

Writes
  assets/rostiq-logo-header.png  dark-mode logo (gradient R + white "RostiQ") for the indigo header,
                                 made from rostiq-logo-primary@2x.png (sharper than the 1x dark PNG)
  app icons, favicon             the R mark (rostiq-icon@2x.png) on white / transparent
  og-image.png                   link preview: the dark-mode logo on deep indigo
Team logos (e.g. assets/wordmark-light.png for Pampas) are separate and not touched.
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
BRAND = os.path.join(ASSETS, "brand")
INDIGO, CYAN, WHITE, OFFWHITE = (30, 27, 75), (0, 212, 255), (255, 255, 255), (246, 247, 250)


def trimmed(name):
    im = Image.open(os.path.join(BRAND, name)).convert("RGBA")
    return im.crop(im.getbbox())


# Dark-mode logo: keep the gradient R, turn the indigo wordmark white (same anti-aliased edges).
primary = trimmed("rostiq-logo-primary@2x.png")
alpha = primary.getchannel("A")
cols = [any(alpha.getpixel((x, y)) > 0 for y in range(primary.height)) for x in range(primary.width)]
r_end = next(x for x in range(primary.width // 10, primary.width) if not cols[x])  # first empty column after the R
dark = primary.copy()
word = Image.new("RGBA", (primary.width - r_end, primary.height), WHITE + (255,))
word.putalpha(alpha.crop((r_end, 0, primary.width, primary.height)))
dark.paste(word, (r_end, 0))
dark.save(os.path.join(ASSETS, "rostiq-logo-header.png"), optimize=True)

# App icons: the R mark centred on white (the maskable one with more margin; Android crops it).
mark = trimmed("rostiq-icon@2x.png")


def icon(size, frac, bg):
    img = Image.new("RGBA", (size, size), bg + (255,) if bg else (0, 0, 0, 0))
    box = round(size * frac)
    scale = box / max(mark.size)
    m = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    img.paste(m, ((size - m.width) // 2, (size - m.height) // 2), m)
    return img


for size, name, frac in ((512, "icon-512.png", .6), (192, "icon-192.png", .6), (512, "icon-maskable-512.png", .46),
                         (180, "apple-touch-icon.png", .6)):
    icon(size, frac, WHITE).convert("RGB").save(os.path.join(ASSETS, name), optimize=True)
icon(64, .94, None).save(os.path.join(ASSETS, "favicon.png"), optimize=True)


def font(names, size):
    for n in names:
        for d in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", "/Library/Fonts/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, size)
    return ImageFont.load_default()


# Link preview 1200×630.
W, H = 1200, 630
img = Image.new("RGB", (W, H), INDIGO)
d = ImageDraw.Draw(img)
d.rectangle([0, H - 12, W, H], fill=CYAN)
lw = 760
logo = dark.resize((lw, round(dark.height * lw / dark.width)), Image.LANCZOS)
img.paste(logo, ((W - lw) // 2, 150), logo)
for text, y, f_, col in (("Teamplanner voor sportploegen", 410, font(["segoeui.ttf", "DejaVuSans.ttf"], 44), OFFWHITE),
                         ("Beschikbaarheid  ·  Carpool  ·  Kalender  ·  WhatsApp", 480, font(["segoeui.ttf", "DejaVuSans.ttf"], 30), CYAN)):
    l, t, r, b = d.textbbox((0, 0), text, font=f_)
    d.text(((W - (r - l)) / 2 - l, y - t), text, font=f_, fill=col)
img.save(os.path.join(ASSETS, "og-image.png"), optimize=True)
print("assets written to", ASSETS, "| header logo", dark.size, "| R ends at x", r_end)
