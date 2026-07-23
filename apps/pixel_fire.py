#!/usr/bin/env python3
"""Demoscene pixel effects: fire, matrix rain, plasma.

    python3 apps/pixel_fire.py [fire|rain|plasma] [--host 127.0.0.1:8080]
"""
import math
import random
import sys

from busybar import BusyBar, BusyBarError, rectangle, host_from_argv, run_loop

APP = "demo.fire"
bar = BusyBar(host_from_argv())

W, H = 72, 16

# ---------------------------------------------------------------------------
# Effect selection
# ---------------------------------------------------------------------------

def _effect_arg():
    valid = {"fire", "rain", "plasma"}
    skip_next = False
    for a in sys.argv[1:]:
        if skip_next:
            skip_next = False
            continue
        if a == "--host":
            skip_next = True
            continue
        if a in valid:
            return a
    return "fire"

EFFECT = _effect_arg()

# ---------------------------------------------------------------------------
# Palettes
# ---------------------------------------------------------------------------

FIRE_PALETTE = [
    None,           # index 0 = black / no rect
    "0x3C0000FF",   # 1 near-black red
    "0x821000FF",   # 2 dark red
    "0xC83200FF",   # 3 red
    "0xFF6400FF",   # 4 orange-red
    "0xFFA028FF",   # 5 orange
    "0xFFE060FF",   # 6 yellow
    "0xFFF8C8FF",   # 7 near-white
]

PLASMA_PALETTE = [
    "0x0A0050FF",   # 0 deep blue
    "0x3A0080FF",   # 1 indigo
    "0x7000A0FF",   # 2 purple
    "0xB0006AFF",   # 3 magenta
    "0xD04000FF",   # 4 orange-red
    "0xE08000FF",   # 5 amber
    "0xFFD000FF",   # 6 yellow
]

RAIN_HEAD   = "0x66CCFFFF"
RAIN_TRAIL  = ["0x3388EEFF", "0x2255BBFF", "0x112E66FF"]

# ---------------------------------------------------------------------------
# Pixel buffer → rectangle list
# ---------------------------------------------------------------------------

def _buf_to_rects(buf, palette):
    """Convert 72×16 index buffer + palette list to rectangle elements.
    index 0 → skip (background). palette[i] = color string.
    Merges horizontal runs of same index per row."""
    rects = []
    for y in range(H):
        x = 0
        while x < W:
            idx = buf[y][x]
            if idx == 0:
                x += 1
                continue
            run_start = x
            x += 1
            while x < W and buf[y][x] == idx:
                x += 1
            rects.append(rectangle(
                x=run_start, y=y,
                width=x - run_start, height=1,
                border_width=0,
                fill="solid",
                fill_colors=[palette[idx]],
            ))
    return rects


def _coarsen(buf):
    """Halve palette indices (except 0) to reduce rect count."""
    return [[max(1, v >> 1) if v else 0 for v in row] for row in buf]


def _build_frame(buf, palette):
    rects = _buf_to_rects(buf, palette)
    while len(rects) > 96:
        buf = _coarsen(buf)
        rects = _buf_to_rects(buf, palette)
    assert len(rects) <= 100
    return rects

# ---------------------------------------------------------------------------
# Fire effect
# ---------------------------------------------------------------------------

_heat = [[0] * W for _ in range(H + 1)]  # row H = heat source
_heat_prev = [[0] * W for _ in range(H)]  # temporal blend buffer


def _tick_fire():
    # Reseed the source row fully each frame: pure random flicker
    for x in range(W):
        _heat[H][x] = random.randint(120, 235)

    # Propagate upward (row H-1 down to 0)
    new_heat = [[0] * W for _ in range(H)]
    for y in range(H - 1, -1, -1):
        for x in range(W):
            xl = max(0, x - 1)
            xr = min(W - 1, x + 1)
            avg = (_heat[y + 1][xl] + _heat[y + 1][x] + _heat[y + 1][xr]
                   + (_heat[y + 1][x] if y + 2 > H else _heat[min(H, y + 2)][x])) // 4
            decay = random.randint(4, 24)
            new_heat[y][x] = max(0, avg - decay)

    # Temporal blend: 66% old, 34% new → slows the flicker without waves
    for y in range(H):
        for x in range(W):
            _heat[y][x] = (2 * _heat_prev[y][x] + new_heat[y][x]) // 3
        # Update prev for next frame
        _heat_prev[y] = list(_heat[y])

    # Smooth horizontally before quantizing: kills pixel speckle so palette
    # bands form long runs (the 100-element draw limit needs wide rects).
    # Radius-6 box filter keeps pre-coarsen rect count well under 96.
    _R = 6
    for y in range(H):
        row = _heat[y]
        _heat[y] = [sum(row[max(0, x - _R):min(W, x + _R + 1)]) //
                    (min(W, x + _R + 1) - max(0, x - _R)) for x in range(W)]

    # Map heat → palette index (7 steps + 0=black)
    n = len(FIRE_PALETTE) - 1  # 7
    buf = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            h = _heat[y][x]
            idx = 0 if h < 24 else max(1, min(n, 1 + (h * n) // 256))
            buf[y][x] = idx

    return _build_frame(buf, FIRE_PALETTE)

# ---------------------------------------------------------------------------
# Rain (matrix) effect
# ---------------------------------------------------------------------------

_drops = []


def _init_rain():
    global _drops
    _drops = []
    for _ in range(20):
        _drops.append({
            "col": random.randint(0, W - 1),
            "y": random.randint(-4, H - 1),
            "speed": random.uniform(0.6, 1.4),
        })


def _tick_rain():
    buf = [[0] * W for _ in range(H)]

    # Using a simple per-cell colour: 0=off, 1=trail dim, 2=trail mid, 3=trail bright, 4=head
    TRAIL_LEN = len(RAIN_TRAIL)
    palette_rain = [None] + RAIN_TRAIL + [RAIN_HEAD]
    HEAD_IDX = len(palette_rain) - 1

    for drop in _drops:
        drop["y"] += drop["speed"]
        hy = int(drop["y"])
        cx = drop["col"]
        if 0 <= hy < H:
            buf[hy][cx] = HEAD_IDX
        for t, color_idx in enumerate(range(1, HEAD_IDX)):
            ty = hy - 1 - t
            if 0 <= ty < H:
                buf[ty][cx] = color_idx
        # respawn
        if hy - TRAIL_LEN > H:
            drop["col"] = random.randint(0, W - 1)
            drop["y"] = random.uniform(-6, -1)
            drop["speed"] = random.uniform(0.6, 1.4)

    # Build rects with per-cell palette
    rects = []
    for y in range(H):
        x = 0
        while x < W:
            idx = buf[y][x]
            if idx == 0:
                x += 1
                continue
            run_start = x
            x += 1
            # Don't merge different indices for rain (columns differ)
            rects.append(rectangle(
                x=run_start, y=y,
                width=1, height=1,
                border_width=0,
                fill="solid",
                fill_colors=[palette_rain[idx]],
            ))
    assert len(rects) <= 100
    return rects

# ---------------------------------------------------------------------------
# Plasma effect
# ---------------------------------------------------------------------------

_t = 0.0


def _tick_plasma():
    global _t
    _t += 0.12
    n = len(PLASMA_PALETTE)

    buf = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            v = (math.sin(x / 6.0 + _t)
                 + math.sin(y / 4.0 - 1.3 * _t)
                 + math.sin((x + y) / 8.0 + 0.7 * _t))
            # v ∈ [-3, 3] → normalize → [0, n-1]
            idx = int((v + 3.0) / 6.0 * (n - 1) + 0.5)
            idx = max(0, min(n - 1, idx))
            buf[y][x] = idx + 1  # 0 reserved for black; shift by 1

    # plasma palette is 0-indexed with an offset; rebuild so index 0 = unused
    plasma_pal = [None] + PLASMA_PALETTE  # index 0 unused, 1..7 = colours
    return _build_frame(buf, plasma_pal)

# ---------------------------------------------------------------------------
# Main tick
# ---------------------------------------------------------------------------

if EFFECT == "rain":
    _init_rain()


def tick():
    try:
        if EFFECT == "fire":
            rects = _tick_fire()
        elif EFFECT == "rain":
            rects = _tick_rain()
        else:
            rects = _tick_plasma()
        bar.display_draw(APP, rects)
    except BusyBarError as e:
        if "→ 409" in str(e):
            return
        raise


if __name__ == "__main__":
    print(f"pixel_fire [{EFFECT}] → {bar.base}  (Ctrl-C to stop)")
    run_loop(tick, interval=0.05)
