#!/usr/bin/env python3
"""Clock widget: big time, refreshed every second.

    python3 apps/clock.py [--host 127.0.0.1:8080]
"""
import time
from busybar import BusyBar, text, host_from_argv, run_loop

APP = "demo.clock"
bar = BusyBar(host_from_argv())


def tick():
    now = time.localtime()
    date = time.strftime("%d.%m.%Y", now)
    hhmm = time.strftime("%H:%M:%S", now)
    # align lets the device place elements without measuring text width.
    bar.display_draw(APP, [
        text(hhmm, x=36, y=15, font="extra_large", color="0xFFFFFFFF", align="bottom_mid"),
    ])


if __name__ == "__main__":
    print(f"clock → {bar.base}  (Ctrl-C to stop)")
    run_loop(tick, interval=1.0)
