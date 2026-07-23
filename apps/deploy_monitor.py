#!/usr/bin/env python3
"""Deploy / CI monitor: green when passing, red + scroll when failing.

Demo mode cycles through states so you can see it move. Swap `next_state()`
for a real call to your CI (GitHub Actions API, webhook, etc.).

    python3 apps/deploy_monitor.py [--host 127.0.0.1:8080]
"""
import signal
import time
from busybar import BusyBar, text, image, host_from_argv

APP = "demo.ci"
bar = BusyBar(host_from_argv())

# (label, ok?) : pretend pipeline; replace with a real status source.
STATES = [
    ("QUEUED",  None),
    ("BUILDING", None),
    ("EXAMPLE.COM DEPLOYED", True),
    ("BUILD FAILED: TESTS", False),
]
i = 0
beeped = False


def render(label, ok):
    # scroll_rate is characters/minute on the real device.
    if ok is True:
        bar.display_draw(APP, [
            image(stock_path="check", x=1, y=1, color="0x28DC6EFF"),
            text(label + "   ", x=11, y=1, font="small", color="0x28DC6EFF",
                 width=61, scroll_rate=420),
            text("ALL SYSTEMS GREEN   ", x=0, y=9, font="small",
                 color="0x3A6B4AFF", width=72, scroll_rate=300),
        ])
    elif ok is False:
        bar.display_draw(APP, [
            image(stock_path="bolt", x=1, y=4, color="0xFF3C3CFF"),
            text(label + "   ", x=10, y=4, font="bold", color="0xFF3C3CFF",
                 width=62, scroll_rate=520),
        ])
    else:
        bar.display_draw(APP, [
            text(label, x=0, y=5, font="small", color="0x7FB2FFFF"),
            text("...", x=58, y=5, font="small", color="0x3A4250FF"),
        ])


if __name__ == "__main__":
    try:
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    except ValueError:
        pass
    print(f"deploy monitor → {bar.base}  (Ctrl-C to stop)")
    try:
        while True:
            label, ok = STATES[i % len(STATES)]
            render(label, ok)
            if ok is False:
                bar.audio_play(APP, "alert.wav")
            print(f"CI: {label}")
            i += 1
            time.sleep(4)
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        try:
            bar.display_clear(APP)
        except Exception:
            pass
