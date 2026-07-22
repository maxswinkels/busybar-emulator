#!/usr/bin/env python3
"""Ping monitor: latency bar chart, green/amber/red like the docs example.

    python3 apps/ping_monitor.py [--target 8.8.8.8] [--host 127.0.0.1:8080]
"""
import subprocess
import sys
import time
from busybar import BusyBar, text, image, host_from_argv

APP = "demo.ping"
bar = BusyBar(host_from_argv())

target = "8.8.8.8"
if "--target" in sys.argv:
    target = sys.argv[sys.argv.index("--target") + 1]

SCALE = 100.0         # ms treated as "slow/timeout" ceiling


def ping_once(host):
    """Return latency in ms, or None on timeout. macOS/Linux ping."""
    try:
        out = subprocess.run(["ping", "-c", "1", "-W", "1000", host],
                             capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return None
    for part in out.split():
        if part.startswith("time="):
            try:
                return float(part.split("=")[1])
            except ValueError:
                return None
    return None


def color_for(ms):
    if ms is None:
        return "0xFF3C3CFF"
    if ms <= 20:
        return "0x28DC6EFF"
    if ms <= 50:
        return "0xFFB000FF"
    return "0xFF3C3CFF"


def tick():
    ms = ping_once(target)
    last = ms if ms is not None else SCALE
    col = color_for(ms)
    label = f"{int(last)}MS" if ms is not None else "TIMEOUT"
    icon = "check" if (ms is not None and ms < 50) else "bolt"
    bar.display_draw(APP, [
        text(f"PING {target}", x=0, y=0, font="small", color="0x7FB2FFFF"),
        text(label, x=0, y=9, font="small", color=col),
        image(stock_path=icon, x=64, y=1, color=col),
    ])
    print(f"{target}: {label}")


if __name__ == "__main__":
    print(f"ping {target} → {bar.base}  (Ctrl-C to stop)")
    try:
        while True:
            tick()
            time.sleep(1.5)
    except KeyboardInterrupt:
        print("\nstopped.")
