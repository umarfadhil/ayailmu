#!/usr/bin/env python3
"""Review sheet for strokes/index.json: every glyph in a cell, each stroke as a coloured polyline with its number at
the START and an arrowhead at the END, over a faint font rendering of the character (Noto Sans CJK, if installed).

Needs Pillow (pip install pillow). Not used by the app or the build.

Usage: python3 art/strokes/contact_sheet.py [index.json] [out.png] [--scale=N] [--cols=N] [--only=key1,key2]
Defaults: android/content/src/main/assets/strokes/index.json -> art/strokes/contact_sheet.png
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FACE = {"hiragana": 0, "hangul": 1, "hanzi": 2}  # JP, KR, SC faces in the collection
COLORS = [(214, 39, 40), (31, 119, 180), (44, 160, 44), (255, 127, 14), (148, 103, 189), (140, 86, 75),
          (227, 119, 194), (23, 190, 207)]


def font(size, face=0):
    try:
        return ImageFont.truetype(CJK, size, index=face)
    except OSError:
        return ImageFont.load_default()


def arrow(d, p, q, color, size):
    ang = math.atan2(q[1] - p[1], q[0] - p[0])
    a1 = (q[0] - size * math.cos(ang - 0.45), q[1] - size * math.sin(ang - 0.45))
    a2 = (q[0] - size * math.cos(ang + 0.45), q[1] - size * math.sin(ang + 0.45))
    d.polygon([q, a1, a2], fill=color)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    src = args[0] if args else os.path.join(REPO, "android/content/src/main/assets/strokes/index.json")
    out = args[1] if len(args) > 1 else os.path.join(REPO, "art/strokes/contact_sheet.png")
    cell = int(opts.get("scale", "150"))
    keys = json.load(open(src, encoding="utf-8"))["keys"]
    if "only" in opts:
        keys = {k: keys[k] for k in opts["only"].split(",")}
    cols = min(int(opts.get("cols", "12")), len(keys))
    label_h = 22
    pad = 6
    rows = math.ceil(len(keys) / cols)
    img = Image.new("RGB", (cols * (cell + pad) + pad, rows * (cell + label_h + pad) + pad), "white")
    d = ImageDraw.Draw(img)
    small = font(max(11, cell // 11), 0)
    num_font = font(max(10, cell // 12), 0)
    width = max(2, cell // 50)
    for i, (key, g) in enumerate(keys.items()):
        x0 = pad + (i % cols) * (cell + pad)
        y0 = pad + (i // cols) * (cell + label_h + pad)
        d.rectangle([x0, y0, x0 + cell, y0 + cell], outline=(170, 170, 170))
        for t in (0.25, 0.5, 0.75):
            c = (225, 225, 225) if t != 0.5 else (205, 205, 205)
            d.line([x0 + t * cell, y0, x0 + t * cell, y0 + cell], fill=c)
            d.line([x0, y0 + t * cell, x0 + cell, y0 + t * cell], fill=c)
        f = font(cell, FACE.get(g.get("script"), 0))
        d.text((x0, y0 + 0.88 * cell), g["glyph"], font=f, fill=(228, 228, 236), anchor="ls")
        for n, s in enumerate(g["strokes"]):
            col = COLORS[n % len(COLORS)]
            pts = [(x0 + x * cell, y0 + y * cell) for x, y in s]
            d.line(pts, fill=col, width=width, joint="curve")
            for p in pts:
                d.ellipse([p[0] - 1.5, p[1] - 1.5, p[0] + 1.5, p[1] + 1.5], fill=(60, 60, 60))
            arrow(d, pts[-2], pts[-1], col, cell / 14)
            sx, sy = pts[0]
            d.ellipse([sx - cell / 22, sy - cell / 22, sx + cell / 22, sy + cell / 22], fill=col)
            d.text((sx, sy), str(n + 1), font=num_font, fill="white", anchor="mm")
        d.text((x0 + 2, y0 + cell + 3), f"{key} {g['glyph']} {len(g['strokes'])}", font=small, fill=(0, 0, 0))
    img.convert("P", palette=Image.Palette.ADAPTIVE, colors=96).save(out, optimize=True)
    print(f"wrote {out} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
