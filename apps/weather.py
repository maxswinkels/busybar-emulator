#!/usr/bin/env python3
"""Weather widget: uploads a real 16x16 PNG icon, then draws it with the temp.

Demonstrates the full asset pipeline: assets_upload -> the emulator serves the
bytes -> the browser decodes and samples them onto the matrix. No PIL needed;
a tiny stdlib PNG encoder builds the icon.

    python3 apps/weather.py [--host 127.0.0.1:8080]
"""
import struct
import time
import zlib
from busybar import BusyBar, text, image, host_from_argv

APP = "demo.weather"
bar = BusyBar(host_from_argv())


def make_png(width, height, rgba):
    """Encode raw RGBA bytes into a PNG (stdlib only)."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        raw.extend(rgba[y * width * 4:(y + 1) * width * 4])
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def sun_icon():
    """16x16 RGBA sun: warm disc + straight/diagonal rays."""
    W = H = 16
    px = bytearray(W * H * 4)
    cx, cy = 7.5, 7.5
    for y in range(H):
        for x in range(W):
            o = (y * W + x) * 4
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            on = d < 4.2
            if 5.0 < d < 7.3:  # rays along the axes and diagonals
                if abs(dx) < 0.9 or abs(dy) < 0.9 or abs(abs(dx) - abs(dy)) < 0.9:
                    on = True
            if on:
                px[o], px[o + 1], px[o + 2], px[o + 3] = 0xFF, 0xC8, 0x3A, 0xFF
    return bytes(px)


def setup():
    png = make_png(16, 16, sun_icon())
    bar.assets_upload(APP, "sun16.png", png)
    print(f"uploaded sun16.png ({len(png)} bytes)")


def tick():
    # Replace with a real API call (open-meteo, wttr.in). Static demo values here.
    bar.display_draw(APP, [
        image("demo.weather/sun16.png", x=0, y=0),
        text("24", x=18, y=1, font="bold", color="0xFFFFFFFF"),
        text("C AMSTERDAM", x=32, y=2, font="small", color="0x7FB2FFFF"),
    ])


if __name__ == "__main__":
    print(f"weather → {bar.base}  (Ctrl-C to stop)")
    setup()
    from busybar import run_loop
    run_loop(tick, interval=5.0)
