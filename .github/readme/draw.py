"""Draws the README's art in the launcher's style: a hero banner, the library
framed on its glow, feature cards, and rounded screenshots."""
import base64
import io
import os
import sys
import textwrap

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


# ---------- showcase: the library on its glow ----------
shot = Image.open(os.path.join(shots, "library.webp")).convert("RGBA")
shot = shot.resize((1800, int(shot.height * 1800 / shot.width)), Image.LANCZOS)
W, H = 2200, shot.height + 260
canvas = gradient((W, H), (20, 11, 39), (10, 7, 20))
canvas.alpha_composite(glow((W, H), (W // 2, H // 2), 900, (124, 58, 237), 120))
canvas.alpha_composite(glow((W, H), (350, 120), 500, (79, 70, 229), 90))
x, y = (W - shot.width) // 2, 140
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((x, y + 30, x + shot.width, y + shot.height + 30), 28, fill=(0, 0, 0, 200))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(40)))
canvas.alpha_composite(rounded(shot, 26, (255, 255, 255, 40)), (x, y))
final = Image.new("RGBA", (W, H), (0, 0, 0, 0))
final.paste(canvas, (0, 0), rounded_mask((W, H), 56))
final.save(os.path.join(out, "showcase.webp"), "WEBP", quality=88, method=6)

# ---------- rounded screenshots ----------
for name in ["mods.webp", "shaders.webp", "manager-log.png", "client-loading.png", "client-menu.webp", "client-settings.webp"]:
    img = Image.open(os.path.join(shots, name)).convert("RGBA")
    if img.width > 1400:
        img = img.resize((1400, int(img.height * 1400 / img.width)), Image.LANCZOS)
    rounded(img, 22).save(os.path.join(out, os.path.splitext(name)[0] + ".webp"), "WEBP", quality=90, method=6)

# ---------- feature cards ----------
ICONS = {
    # lucide-style strokes, 24x24
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "box": '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    "server": '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    "pulse": '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    "zap": '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
}
CARDS = [
    ("grid", "A library you arrange", "Hold a card to move it or throw it away. Gather instances in folders with their own name, colour and picture."),
    ("box", "Modpacks in one click", "The right Minecraft version and loader, and the pack's own logo as its picture."),
    ("server", "Host", "Run a server from an instance or a preset: console, players, mods, files and backups."),
    ("pulse", "Crashes explained", "The report names the mod at fault, and sends itself if you allow it."),
    ("search", "One search", "Modrinth and CurseForge together: mods, shaders, resource packs, data packs and modpacks."),
    ("zap", "Two engines", "Java with Fabric, Forge, NeoForge and Quilt, or Kizaflux, an experimental engine in Rust."),
]
CW, CH, GAP, PAD = 400, 214, 20, 20
FW, FH = PAD * 2 + CW * 3 + GAP * 2, PAD * 2 + CH * 2 + GAP
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{FW}" height="{FH}" viewBox="0 0 {FW} {FH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BG1}"/><stop offset="1" stop-color="{BG0}"/></linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.02"/></linearGradient>
    <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7c3aed" stop-opacity="0.35"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><rect width="{FW}" height="{FH}" rx="32"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
  <rect width="{FW}" height="{FH}" fill="url(#bg)"/>
  <ellipse cx="{FW * 0.2}" cy="0" rx="520" ry="260" fill="url(#glow)"/>
  <ellipse cx="{FW * 0.85}" cy="{FH}" rx="520" ry="260" fill="url(#glow)"/>''']
for index, (icon, title, body) in enumerate(CARDS):
    cx = PAD + (index % 3) * (CW + GAP)
    cy = PAD + (index // 3) * (CH + GAP)
    lines = textwrap.wrap(body, 44)
    text = "".join(f'<tspan x="{cx + 28}" dy="{0 if i == 0 else 25}">{line}</tspan>' for i, line in enumerate(lines))
    parts.append(f'''
  <rect x="{cx}" y="{cy}" width="{CW}" height="{CH}" rx="22" fill="url(#card)" stroke="#ffffff" stroke-opacity="0.08"/>
  <rect x="{cx + 28}" y="{cy + 28}" width="48" height="48" rx="14" fill="url(#chip)"/>
  <g transform="translate({cx + 40} {cy + 40})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ICONS[icon]}</g>
  <text x="{cx + 28}" y="{cy + 112}" font-family="{FONT}" font-size="21" font-weight="700" fill="{TEXT}">{title}</text>
  <text x="{cx + 28}" y="{cy + 144}" font-family="{FONT}" font-size="16" fill="{MUTED}">{text}</text>''')
parts.append(f'''
  <rect x="0.5" y="0.5" width="{FW - 1}" height="{FH - 1}" rx="31.5" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
  </g>
</svg>
''')
open(os.path.join(out, "features.svg"), "w", encoding="utf-8").write("".join(parts))

for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, "KB")
