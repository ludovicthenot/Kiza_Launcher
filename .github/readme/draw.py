"""Draws the README's art in the launcher's style: a hero banner, the library
framed on its glow, a bento of features made of the launcher's own pieces, and
scenes of several windows laid over one another."""
import base64
import io
import os
import sys
import textwrap

import numpy

from PIL import Image, ImageDraw, ImageFilter

# Run from the repository root: python .github/readme/draw.py .
root = sys.argv[1]
shots = os.path.join(root, ".github", "screenshots")
out = os.path.join(root, ".github", "readme")
os.makedirs(out, exist_ok=True)

FONT = "Inter, 'Segoe UI Variable Display', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif"
BG0, BG1 = "#0c0817", "#140b27"
ACCENT, ACCENT2 = "#8b5cf6", "#c4b5fd"
TEXT, MUTED = "#f5f3ff", "#a79fc4"


def b64(path):
    return base64.b64encode(open(path, "rb").read()).decode()


# ---------- hero ----------
logo = b64(os.path.join(root, ".github", "kiza.png"))
hero = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="440" viewBox="0 0 1280 440">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{BG1}"/><stop offset="1" stop-color="{BG0}"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.55"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#4f46e5" stop-opacity="0.35"/><stop offset="1" stop-color="#4f46e5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="logoGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.75"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="{ACCENT2}"/>
    </linearGradient>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#ffffff" fill-opacity="0.05"/>
    </pattern>
    <clipPath id="card"><rect width="1280" height="440" rx="32"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="1280" height="440" fill="url(#bg)"/>
    <rect width="1280" height="440" fill="url(#dots)"/>
    <ellipse cx="300" cy="80" rx="560" ry="330" fill="url(#glowA)"/>
    <ellipse cx="1120" cy="420" rx="520" ry="300" fill="url(#glowB)"/>
    <ellipse cx="640" cy="130" rx="150" ry="110" fill="url(#logoGlow)"/>
    <image x="584" y="74" width="112" height="112" xlink:href="data:image/png;base64,{logo}"/>
    <text x="640" y="262" text-anchor="middle" font-family="{FONT}" font-size="64" font-weight="800" letter-spacing="-1.5" fill="url(#title)">Kiza Launcher</text>
    <text x="640" y="306" text-anchor="middle" font-family="{FONT}" font-size="23" fill="{MUTED}">A Minecraft launcher that tells the truth.</text>
    <g font-family="{FONT}" font-size="15" font-weight="600">
      <rect x="452" y="344" width="146" height="36" rx="18" fill="#8b5cf6" fill-opacity="0.18" stroke="#a78bfa" stroke-opacity="0.45"/>
      <circle cx="474" cy="362" r="4" fill="#a78bfa"/>
      <text x="486" y="367" fill="{ACCENT2}">Closed beta</text>
      <rect x="610" y="344" width="104" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.12"/>
      <text x="662" y="367" text-anchor="middle" fill="{TEXT}" fill-opacity="0.85">Windows</text>
      <rect x="726" y="344" width="102" height="36" rx="18" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.12"/>
      <text x="777" y="367" text-anchor="middle" fill="{TEXT}" fill-opacity="0.85">Rust</text>
    </g>
    <rect x="0.5" y="0.5" width="1279" height="439" rx="31.5" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
  </g>
</svg>
'''
open(os.path.join(out, "hero.svg"), "w", encoding="utf-8").write(hero)


# ---------- raster helpers ----------
def rounded_mask(size, radius, scale=4):
    w, h = size
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def rounded(img, radius, border=(255, 255, 255, 30)):
    img = img.convert("RGBA")
    mask = rounded_mask(img.size, radius)
    shaped = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shaped.paste(img, (0, 0), mask)
    # a hairline, as the launcher's cards have
    scale = 4
    w, h = img.size
    ring = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius * scale, outline=border, width=2 * scale)
    shaped.alpha_composite(ring.resize(img.size, Image.LANCZOS))
    return shaped


def gradient(size, top, bottom):
    w, h = size
    g = Image.new("RGBA", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    return g.resize(size)


def glow(size, center, radius, colour, alpha):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    cx, cy = center
    ImageDraw.Draw(layer).ellipse((cx - radius, cy - radius * 0.7, cx + radius, cy + radius * 0.7), fill=colour + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.45))


def _perspective_coefficients(to_points, from_points):
    """PIL's PERSPECTIVE data: maps each output corner back to the input's."""
    rows, values = [], []
    for (X, Y), (x, y) in zip(to_points, from_points):
        rows.append([X, Y, 1, 0, 0, 0, -x * X, -x * Y])
        rows.append([0, 0, 0, X, Y, 1, -y * X, -y * Y])
        values += [x, y]
    return numpy.linalg.solve(numpy.array(rows, float), numpy.array(values, float)).tolist()


def turned(img, depth=0.12, lift=0.0):
    """
    The window turned toward the right, as a screen seen from its left: its
    left edge near and whole, its right edge further, so shorter, and a
    touch higher with `lift`. Lit from the left, dimmer as it goes back.
    """
    img = img.convert("RGBA")
    w, h = img.size
    far_w = w * (1 - 0.32 * depth)
    shrink = h * depth / 2
    corners = [(0, 0), (far_w, shrink - h * lift), (far_w, h - shrink - h * lift), (0, h)]
    top = min(y for _, y in corners)
    corners = [(x, y - top) for x, y in corners]
    size = (int(far_w) + 1, int(max(y for _, y in corners)) + 1)
    data = _perspective_coefficients(corners, [(0, 0), (w, 0), (w, h), (0, h)])
    out_img = img.transform(size, Image.PERSPECTIVE, data, Image.BICUBIC)
    # Light from the left, falling off toward the far edge.
    alpha = out_img.getchannel("A")
    for colour, strength in (((255, 255, 255), lambda t: 24 * (1 - t) ** 2), ((0, 0, 0), lambda t: 72 * t ** 1.6)):
        ramp = Image.new("RGBA", (size[0], 1))
        for x in range(size[0]):
            ramp.putpixel((x, 0), colour + (int(strength(x / max(1, size[0] - 1))),))
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        layer.paste(ramp.resize(size), (0, 0), alpha)
        out_img.alpha_composite(layer)
    return out_img


def set_down(canvas, img, x, y, blur):
    """A turned window on the canvas, with the shadow its own shape casts."""
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    dark = Image.new("RGBA", img.size, (0, 0, 0, 200))
    shadow.paste(dark, (x + blur // 2, y + blur), img.getchannel("A"))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(img, (x, y))


# ---------- showcase: the library on its glow ----------
shot = Image.open(os.path.join(shots, "library.webp")).convert("RGBA")
shot = shot.resize((1800, int(shot.height * 1800 / shot.width)), Image.LANCZOS)
W, H = 2200, shot.height + 260
canvas = gradient((W, H), (20, 11, 39), (10, 7, 20))
canvas.alpha_composite(glow((W, H), (W // 2, H // 2), 900, (124, 58, 237), 120))
canvas.alpha_composite(glow((W, H), (350, 120), 500, (79, 70, 229), 90))
window = turned(rounded(shot, 26, (255, 255, 255, 40)), depth=0.1)
set_down(canvas, window, (W - window.width) // 2, (H - window.height) // 2 + 10, 40)
final = Image.new("RGBA", (W, H), (0, 0, 0, 0))
final.paste(canvas, (0, 0), rounded_mask((W, H), 56))
final.save(os.path.join(out, "showcase.webp"), "WEBP", quality=88, method=6)

# ---------- features: a bento of the launcher's own pieces ----------
from PIL import ImageFont

S = 2  # drawn at twice the size, shown at half: sharp on every screen
FONTS = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(FONTS + name, size * S)


def px(*values):
    return tuple(int(v * S) for v in values)


def wrap(draw, text, face, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = (line + " " + word).strip()
        if draw.textlength(trial, font=face) <= width * S:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def fade_bottom(img, start=0.55):
    """The picture fades into the card toward its foot, as if it went on."""
    img = img.convert("RGBA")
    w, h = img.size
    alpha = img.getchannel("A")
    ramp = Image.new("L", (1, h))
    for y in range(h):
        t = (y / h - start) / (1 - start)
        ramp.putpixel((0, y), 255 if t <= 0 else int(255 * max(0, 1 - t) ** 1.6))
    from PIL import ImageChops
    img.putalpha(ImageChops.multiply(alpha, ramp.resize((w, h))))
    return img


def rgba(hex_colour, alpha=255):
    hex_colour = hex_colour.lstrip("#")
    return tuple(int(hex_colour[i:i + 2], 16) for i in (0, 2, 4)) + (alpha,)


FW, FH = 1280, 1060
board = gradient(px(FW, FH), (20, 11, 39), (10, 7, 20))
board.alpha_composite(glow(board.size, px(260, 40), 620 * S, (124, 58, 237), 110))
board.alpha_composite(glow(board.size, px(1100, 1020), 620 * S, (79, 70, 229), 80))
draw = ImageDraw.Draw(board)
TITLE, BODY, SMALL, TINY = font("seguisb.ttf", 22), font("segoeui.ttf", 15), font("seguisb.ttf", 13), font("seguisb.ttf", 10)
WHITE, GREY = rgba("#f5f3ff"), rgba("#a79fc4")


def card(x, y, w, h, title, body, text_width=None):
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(px(x, y, x + w, y + h), 24 * S, fill=(255, 255, 255, 11), outline=(255, 255, 255, 22), width=S)
    board.alpha_composite(layer)
    draw.text(px(x + 28, y + 26), title, font=TITLE, fill=WHITE)
    top = y + 64
    for line in wrap(draw, body, BODY, text_width or w - 56):
        draw.text(px(x + 28, top), line, font=BODY, fill=GREY)
        top += 22
    return top


def place(img, x, y, w, radius=16, fade=0.55):
    img = img.convert("RGBA")
    img = img.resize(px(w, w * img.height / img.width), Image.LANCZOS)
    img = rounded(img, radius * S, (255, 255, 255, 26))
    if fade is not None:
        img = fade_bottom(img, fade)
    board.alpha_composite(img, px(x, y))


def clip_to(x, y, w, h, img_fn):
    """Draws what img_fn adds only inside a card's box."""
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    img_fn(layer)
    mask = Image.new("L", board.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(px(x, y, x + w, y + h), 24 * S, fill=255)
    clipped = Image.new("RGBA", board.size, (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), mask)
    board.alpha_composite(clipped)


library = Image.open(os.path.join(shots, "library.webp"))
mods = Image.open(os.path.join(shots, "mods.webp"))
log = Image.open(os.path.join(shots, "manager-log.png"))
menu = Image.open(os.path.join(shots, "client-menu.webp"))

# 1. The library, its own cards and groups.
card(20, 20, 760, 400, "A library you arrange", "Hold a card to move it or throw it away. Gather instances in folders with their own name, colour and picture.", 560)
cards = library.crop((40, 300, 1250, 680))
clip_to(20, 20, 760, 400, lambda layer: layer.alpha_composite(
    fade_bottom(rounded(cards.resize(px(704, 704 * cards.height / cards.width), Image.LANCZOS), 16 * S, (255, 255, 255, 0)), 0.62), px(48, 160)))

# 2. The engine picker, as the launcher draws it.
card(800, 20, 460, 400, "Two engines", "Java as Mojang ships it, or Kizaflux: an engine in Rust, built on Horizon.")
def engine(x, y, name, line, active, badge=None):
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(px(x, y, x + 404, y + 76), 16 * S,
                        fill=(139, 92, 246, 40) if active else (255, 255, 255, 10),
                        outline=(167, 139, 250, 200) if active else (255, 255, 255, 20), width=(2 if active else 1) * S)
    d.rounded_rectangle(px(x + 16, y + 16, x + 60, y + 60), 12 * S, fill=(255, 255, 255, 16))
    board.alpha_composite(layer)
    ink = rgba("#a78bfa") if active else GREY
    if badge:
        # a bolt, as the launcher's Rust choice has
        bolt = [(x + 41, y + 25), (x + 31, y + 40), (x + 38, y + 40), (x + 36, y + 51), (x + 46, y + 35), (x + 39, y + 35)]
        draw.polygon([px(*point) for point in bolt], outline=ink, width=2 * S)
    else:
        # a cup, as its Java choice has
        draw.rounded_rectangle(px(x + 28, y + 30, x + 44, y + 48), 3 * S, outline=ink, width=2 * S)
        draw.arc(px(x + 39, y + 33, x + 50, y + 43), -90, 90, fill=ink, width=2 * S)
        for steam in (32, 36, 40):
            draw.line(px(x + steam, y + 21, x + steam, y + 26), fill=ink, width=2 * S)
    draw.text(px(x + 76, y + 16), name, font=font("seguisb.ttf", 16), fill=WHITE)
    if badge:
        bx = x + 76 + draw.textlength(name, font=font("seguisb.ttf", 16)) / S + 10
        bw = draw.textlength(badge, font=TINY) / S + 16
        pill = Image.new("RGBA", board.size, (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle(px(bx, y + 19, bx + bw, y + 37), 9 * S, fill=(251, 191, 36, 34), outline=(251, 191, 36, 100), width=S)
        board.alpha_composite(pill)
        draw.text(px(bx + bw / 2, y + 28), badge, font=TINY, fill=rgba("#fcd34d"), anchor="mm")
    draw.text(px(x + 76, y + 42), line, font=font("segoeui.ttf", 13), fill=GREY)
    if active:
        draw.line([px(x + 376, y + 22), px(x + 381, y + 27), px(x + 390, y + 17)], fill=rgba("#a78bfa"), width=3 * S, joint="curve")
engine(828, 150, "Java", "Minecraft: Java Edition", False)
engine(828, 240, "Rust", "Kizaflux powered by Horizon", True, "EXPERIMENTAL")
draw.text(px(828, 340), "Fabric \u00b7 Forge \u00b7 NeoForge \u00b7 Quilt on Java", font=font("segoeui.ttf", 13), fill=GREY)
draw.text(px(828, 362), "Vanilla 26.3 on Kizaflux, for now", font=font("segoeui.ttf", 13), fill=GREY)

# 3. Two catalogues, one list: the sources as the mods page shows them.
card(20, 440, 400, 330, "One search", "Modrinth and CurseForge in one list: mods, shaders, packs and modpacks.")
rows = mods.crop((420, 395, 1420, 700))
clip_to(20, 440, 400, 330, lambda layer: layer.alpha_composite(
    fade_bottom(rounded(rows.resize(px(560, 560 * rows.height / rows.width), Image.LANCZOS), 14 * S, (255, 255, 255, 0)), 0.5), px(48, 590)))

# 4. The game's log, sorted.
card(440, 440, 400, 330, "Crashes explained", "The report names the mod at fault. The log, sorted by where each line comes from.")
filters = log.crop((728, 290, 1420, 345))
lines = log.crop((40, 360, 760, 640))
def draw_log(layer):
    f = filters.resize(px(344, 344 * filters.height / filters.width), Image.LANCZOS)
    layer.alpha_composite(rounded(f, 10 * S, (255, 255, 255, 0)), px(468, 590))
    l = lines.resize(px(420, 420 * lines.height / lines.width), Image.LANCZOS)
    layer.alpha_composite(fade_bottom(rounded(l, 12 * S, (255, 255, 255, 0)), 0.35), px(468, 630))
clip_to(440, 440, 400, 330, draw_log)

# 5. Host: the servers list, drawn as the launcher's sidebar draws it.
card(860, 440, 400, 330, "Host", "Run a server from an instance or a preset: console, players, mods, files, backups.")
def server(y, name, line, running):
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(px(888, y, 1232, y + 56), 14 * S, fill=(139, 92, 246, 34) if running else (255, 255, 255, 9),
                        outline=(167, 139, 250, 120) if running else (255, 255, 255, 18), width=S)
    d.rounded_rectangle(px(900, y + 10, 936, y + 46), 10 * S, fill=(124, 58, 237, 150) if running else (255, 255, 255, 20))
    board.alpha_composite(layer)
    draw.text(px(948, y + 10), name, font=font("seguisb.ttf", 14), fill=WHITE)
    draw.text(px(948, y + 30), line, font=font("segoeui.ttf", 12), fill=GREY)
    dot = rgba("#34d399") if running else rgba("#6b6585")
    draw.ellipse(px(1210, y + 24, 1218, y + 32), fill=dot)
draw.text(px(888, 568), "RUNNING", font=TINY, fill=GREY)
server(586, "Survival", "1.21.11 \u00b7 Fabric \u00b7 port 25565", True)
draw.text(px(888, 656), "STOPPED", font=TINY, fill=GREY)
server(674, "Creative build", "26.3 \u00b7 Vanilla", False)

# 6. The Kiza Client, wide.
card(20, 790, 1240, 250, "The Kiza Client", "A title screen of its own on a moving background, its own loading screen, and settings for both. Built for Fabric and three generations of Forge.", 420)
art = menu.crop((0, 40, 2000, 700))
clip_to(20, 790, 1240, 250, lambda layer: layer.alpha_composite(
    rounded(art.resize(px(680, 680 * art.height / art.width), Image.LANCZOS), 16 * S, (255, 255, 255, 26)), px(560, 803)))

final = Image.new("RGBA", board.size, (0, 0, 0, 0))
final.paste(board, (0, 0), rounded_mask(board.size, 32 * S))
final.save(os.path.join(out, "features.webp"), "WEBP", quality=90, method=6)

# ---------- scenes: several windows laid over one another, on the glow ----------
def scene(name, title, subtitle, windows, size=(1280, 740)):
    """`windows` from the back to the front: (picture, x, y, width, depth), each
    turned toward the right by its depth."""
    W, H = size
    canvas = gradient(px(W, H), (20, 11, 39), (10, 7, 20))
    canvas.alpha_composite(glow(canvas.size, px(W * 0.7, H * 0.55), 640 * S, (124, 58, 237), 120))
    canvas.alpha_composite(glow(canvas.size, px(120, 40), 460 * S, (79, 70, 229), 90))
    d = ImageDraw.Draw(canvas)
    d.text(px(48, 40), title, font=font("seguisb.ttf", 30), fill=WHITE)
    d.text(px(48, 84), subtitle, font=font("segoeui.ttf", 16), fill=GREY)
    for picture, x, y, width, depth in windows:
        img = picture.convert("RGBA")
        img = img.resize(px(width, width * img.height / img.width), Image.LANCZOS)
        set_down(canvas, turned(rounded(img, 14 * S, (255, 255, 255, 40)), depth, 0.02), x * S, y * S, 26 * S)
    final = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    final.paste(canvas, (0, 0), rounded_mask(canvas.size, 32 * S))
    final.save(os.path.join(out, name), "WEBP", quality=90, method=6)


def shot(name):
    return Image.open(os.path.join(shots, name))


scene(
    "tour.webp",
    "Inside an instance",
    "Every kind of content in its own place, and the game's log while it runs.",
    [
        (shot("shaders.webp"), 500, 140, 760, 0.16),
        (shot("mods.webp"), 40, 196, 780, 0.14),
        (shot("manager-log.png"), 820, 380, 430, 0.12),
    ],
)
scene(
    "client.webp",
    "The Kiza Client",
    "Its own title screen on a moving background, its own loading screen, and the settings for both.",
    [
        (shot("client-menu.webp"), 40, 140, 780, 0.14),
        (shot("client-settings.webp"), 560, 200, 700, 0.16),
        (shot("client-loading.png"), 90, 470, 390, 0.12),
    ],
    size=(1280, 760),
)

for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, "KB")
