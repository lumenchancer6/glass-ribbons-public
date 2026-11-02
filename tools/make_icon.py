"""Desktop icon: a dark garden tile and two iridescent ribbon curls.

    python tools/make_icon.py
"""

import os
from PIL import Image, ImageDraw

S = 256
INK = (12, 28, 20, 255)
GREEN = (36, 214, 112, 255)
PINK = (232, 54, 176, 255)
GOLD = (255, 214, 84, 255)

OUT_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]


def build(size=S):
    k = size / S
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8 * k, 8 * k, size - 8 * k, size - 8 * k), radius=48 * k, fill=INK)
    width = max(2, round(14 * k))
    d.line(
        [(46 * k, 188 * k), (78 * k, 96 * k), (132 * k, 64 * k), (176 * k, 108 * k), (150 * k, 168 * k)],
        fill=GREEN,
        width=width,
        joint="curve",
    )
    d.line(
        [(64 * k, 206 * k), (118 * k, 150 * k), (168 * k, 176 * k), (204 * k, 78 * k)],
        fill=PINK,
        width=max(2, round(11 * k)),
        joint="curve",
    )
    d.line(
        [(92 * k, 120 * k), (140 * k, 132 * k), (188 * k, 96 * k)],
        fill=GOLD,
        width=max(1, round(4 * k)),
        joint="curve",
    )
    return img


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "assets")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "glass-ribbons.ico")
    img = build()
    img.save(path, format="ICO", sizes=OUT_SIZES)
    img.save(os.path.join(out_dir, "glass-ribbons-256.png"), format="PNG")
    print("WROTE", path)


if __name__ == "__main__":
    main()
