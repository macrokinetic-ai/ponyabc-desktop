#!/usr/bin/env python3
"""Generate the Microsoft Store (Appx) tile/logo assets and the Windows .exe icon from the official
PonyABC logo (build/source/ponyabc_logo1.png, copied unmodified from the brand asset).

Output:
  build/appx/*.png   -> picked up by electron-builder's appx target (buildResources/appx). Scaled
                        (.scale-N / .targetsize-N) variants make electron-builder run makepri and
                        produce resources.pri, so Windows picks the right size per display.
  build/icon.ico     -> Windows executable / taskbar icon (16-256 px).

The logo is only cropped to its visible content, uniformly scaled (aspect ratio preserved) and
centred on a transparent canvas — never stretched, recoloured or redrawn. Tiles are shown on
`appx.backgroundColor` (white, see electron-builder.win-appx.yml).

Usage: python3 scripts/generate-appx-assets.py   (needs Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "source" / "ponyabc_logo1.png"
OUT = ROOT / "build" / "appx"

# Fraction of the canvas the logo may occupy (leaves a safe margin, incl. for tile corner rounding).
FILL = 0.84


def load_logo() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    # The source PNG has an opaque white blob behind the artwork rather than real transparency.
    # Make just that outer white background transparent (flood fill from the corners, so the
    # enclosed white letters of "ABC" and the highlights are untouched); colours are not altered.
    matte = Image.new("RGB", im.size, (255, 255, 255))
    matte.paste(im, (0, 0), im)
    marker = (255, 0, 255)
    for corner in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
        ImageDraw.floodfill(matte, corner, marker, thresh=24)
    mask = Image.eval(matte.convert("RGB").getchannel("G"), lambda g: 255 if g == 0 else 0)
    alpha = im.getchannel("A")
    alpha.paste(0, (0, 0), mask)
    im.putalpha(alpha)
    # Ignore near-invisible fringe pixels when measuring the visible content.
    bbox = im.getchannel("A").point(lambda v: 255 if v >= 24 else 0).getbbox()
    return im.crop(bbox)


def render(logo: Image.Image, w: int, h: int, fill: float = FILL) -> Image.Image:
    scale = min(w * fill / logo.width, h * fill / logo.height)
    size = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    scaled = logo.resize(size, Image.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(scaled, ((w - size[0]) // 2, (h - size[1]) // 2), scaled)
    return canvas


def main() -> None:
    logo = load_logo()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()

    scales = {100: 1.0, 125: 1.25, 150: 1.5, 200: 2.0, 400: 4.0}
    # name -> base (w, h) at scale-100
    tiles = {
        "StoreLogo": (50, 50),
        "Square44x44Logo": (44, 44),
        "SmallTile": (71, 71),
        "Square150x150Logo": (150, 150),
        "Wide310x150Logo": (310, 150),
        "LargeTile": (310, 310),
    }
    for name, (bw, bh) in tiles.items():
        for pct, f in scales.items():
            render(logo, round(bw * f), round(bh * f)).save(OUT / f"{name}.scale-{pct}.png")

    # App-list / taskbar / title-bar icons. Plated (on backgroundColor) and unplated variants.
    for t in (16, 24, 32, 48, 256):
        img = render(logo, t, t, fill=0.94)
        img.save(OUT / f"Square44x44Logo.targetsize-{t}.png")
        img.save(OUT / f"Square44x44Logo.targetsize-{t}_altform-unplated.png")

    # Windows executable icon.
    ico = render(logo, 256, 256, fill=0.94)
    ico.save(ROOT / "build" / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print(f"wrote {len(list(OUT.glob('*.png')))} PNGs to {OUT} and build/icon.ico")


if __name__ == "__main__":
    main()
