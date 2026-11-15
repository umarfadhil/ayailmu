#!/usr/bin/env python3
"""Write the iOS app icon from the same drawing as the Android launcher icon (draw.py key `app_icon`).

  python3 art/tools/ios_icon.py

Writes ios/AyaIlmu/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png: 1024 x 1024, opaque RGB on the light paper,
cropped to the central 184 of the 240 units so Aya fills the tile about as much as on an Android launcher (which shows
the central 160). iOS applies its own corner mask. macOS only: rasterises with QuickLook (qlmanage) and flattens with
Pillow, because no SVG renderer is installed here.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import draw  # noqa: E402

from PIL import Image  # noqa: E402

CROP = 184
PX = 1024
OUT = draw.REPO / "ios/AyaIlmu/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"


def main():
    a = draw.render("app_icon")
    svg = draw.to_svg(a, draw.LIGHT, draw.LIGHT_BG)
    x0 = (a.vw - CROP) / 2
    svg = svg.replace(
        f'width="{a.vw}" height="{a.vh}" viewBox="0 0 {a.vw} {a.vh}"',
        f'width="{PX}" height="{PX}" viewBox="{x0:g} {x0:g} {CROP} {CROP}"',
        1,
    )
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "app_icon.svg"
        src.write_text(svg, encoding="utf-8")
        subprocess.run(["qlmanage", "-t", "-s", str(PX), "-o", tmp, str(src)], check=True, capture_output=True)
        im = Image.open(Path(tmp) / "app_icon.svg.png")
        if im.size != (PX, PX):
            sys.exit(f"QuickLook returned {im.size}, expected {PX}x{PX}")
        flat = Image.new("RGB", im.size, draw.LIGHT_BG)
        flat.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[3])
        OUT.parent.mkdir(parents=True, exist_ok=True)
        flat.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(draw.REPO)}")


if __name__ == "__main__":
    main()
