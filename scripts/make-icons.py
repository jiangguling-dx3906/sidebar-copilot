"""Generate the extension icons (gradient tile + speech bubble).

Run with: python scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
SIZE = 1024


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, stops):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.45 + y * 0.55) / size
            for i in range(len(stops) - 1):
                start, color_a = stops[i]
                end, color_b = stops[i + 1]
                if t <= end:
                    span = max(end - start, 1e-6)
                    c = mix(color_a, color_b, max(0.0, (t - start) / span))
                    break
            else:
                c = stops[-1][1]
            px[x, y] = c
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    stops = [
        (0.00, (67, 56, 202)),    # indigo-700
        (0.55, (139, 92, 246)),   # violet-500
        (1.00, (217, 70, 239)),   # fuchsia-500
    ]
    base = gradient(SIZE, stops).convert("RGBA")

    # Soft diagonal highlight: white fading from the top-left corner.
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    opaque = Image.new("L", (SIZE, SIZE), 0)
    opx = opaque.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2 * SIZE)
            opx[x, y] = max(0, round(46 * (1 - t) ** 2))
    overlay.putalpha(opaque)
    base = Image.alpha_composite(base, overlay)

    # Rounded tile mask.
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=255
    )

    # Speech bubble with a tail and three dots.
    draw = ImageDraw.Draw(base)
    left, top, right, bottom = SIZE * 0.20, SIZE * 0.25, SIZE * 0.80, SIZE * 0.65
    draw.rounded_rectangle(
        [left, top, right, bottom], radius=int(SIZE * 0.12), fill=(255, 255, 255, 255)
    )
    draw.polygon(
        [
            (SIZE * 0.31, SIZE * 0.60),
            (SIZE * 0.295, SIZE * 0.775),
            (SIZE * 0.445, SIZE * 0.635),
        ],
        fill=(255, 255, 255, 255),
    )

    dot_y = SIZE * 0.450
    radius = SIZE * 0.041
    for cx in (SIZE * 0.365, SIZE * 0.500, SIZE * 0.635):
        draw.ellipse(
            [cx - radius, dot_y - radius, cx + radius, dot_y + radius],
            fill=(79, 70, 229, 255),
        )

    base.putalpha(mask)
    for target in (128, 48, 32, 16):
        base.resize((target, target), Image.LANCZOS).save(
            OUT / f"icon{target}.png", optimize=True
        )

    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
