#!/usr/bin/env python3
"""Generate PWA icons for SMC Sniper: dark bg + green/red candles."""
from PIL import Image, ImageDraw

BG = (11, 14, 17, 255)        # #0b0e11
GREEN = (34, 197, 94, 255)    # #22c55e
RED = (239, 68, 68, 255)      # #ef4444
GRID = (35, 42, 54, 255)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    s = size

    # subtle grid lines
    for frac in (0.25, 0.5, 0.75):
        y = int(s * frac)
        d.line([(0, y), (s, y)], fill=GRID, width=max(1, s // 256))

    # scale factor: maskable keeps content in 80% safe zone
    pad = 0.30 if maskable else 0.22
    area_t, area_b = int(s * pad), int(s * (1 - pad))
    area_h = area_b - area_t

    def candle(cx: float, body_top: float, body_bot: float, wick_top: float, wick_bot: float, color, width: float):
        x = int(s * cx)
        bw = int(s * width)
        # wick
        d.line([(x, int(s * wick_top)), (x, int(s * wick_bot))], fill=color, width=max(2, int(s * 0.02)))
        # body
        d.rounded_rectangle(
            [x - bw // 2, int(s * body_top), x + bw // 2, int(s * body_bot)],
            radius=max(2, int(s * 0.015)),
            fill=color,
        )

    # green candle (up) left, red candle (down) right
    candle(
        cx=0.36,
        body_top=0.42, body_bot=0.70,
        wick_top=0.32, wick_bot=0.78,
        color=GREEN, width=0.14,
    )
    candle(
        cx=0.64,
        body_top=0.30, body_bot=0.55,
        wick_top=0.22, wick_bot=0.68,
        color=RED, width=0.14,
    )

    # trend arrow from red to green (down->up = bullish reversal)
    aw = max(3, int(s * 0.035))
    ax1, ay1 = int(s * 0.30), int(s * 0.80)
    ax2, ay2 = int(s * 0.72), int(s * 0.24)
    d.line([(ax1, ay1), (ax2, ay2)], fill=(232, 234, 237, 255), width=aw)
    # arrowhead
    d.polygon(
        [
            (ax2 - int(s * 0.06), ay2 + int(s * 0.015)),
            (ax2 + int(s * 0.03), ay2 - int(s * 0.02)),
            (ax2 - int(s * 0.015), ay2 + int(s * 0.075)),
        ],
        fill=(232, 234, 237, 255),
    )
    return img


import os

os.makedirs("/home/z/my-project/public/icons", exist_ok=True)
draw_icon(192).save("/home/z/my-project/public/icons/icon-192.png")
draw_icon(512).save("/home/z/my-project/public/icons/icon-512.png")
draw_icon(512, maskable=True).save("/home/z/my-project/public/icons/maskable-512.png")
# favicon-size
draw_icon(64).save("/home/z/my-project/public/icons/icon-64.png")
print("icons saved:", os.listdir("/home/z/my-project/public/icons"))
