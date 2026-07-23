#!/usr/bin/env python3
"""Play stock sounds through the BUSY Bar one by one.

    python3 apps/sound_test.py [sound ...] [--gap SECONDS] [--volume N]

    No sound args (or the single arg 'all'): fetch /api/_sounds from the
    emulator and play every available sound in alphabetical order.  On real
    hardware the listing endpoint is absent; pass explicit names instead.

    python3 apps/sound_test.py glass              # play one sound
    python3 apps/sound_test.py glass glass        # play it twice
    python3 apps/sound_test.py --volume 70 --gap 1.5
    python3 apps/sound_test.py --host 10.0.4.20 glass
"""
import sys
import time
import json
import urllib.request
import urllib.error
from busybar import BusyBar, text, host_from_argv

APP = "sound_test"


def parse_args():
    args = sys.argv[1:]
    host = host_from_argv()
    gap = 2.0
    volume = None
    sounds = []

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--host":
            i += 2          # already consumed by host_from_argv
            continue
        if a == "--gap":
            gap = float(args[i + 1]); i += 2; continue
        if a == "--volume":
            volume = int(args[i + 1]); i += 2; continue
        if not a.startswith("-"):
            sounds.append(a)
        i += 1

    # "all" as the sole positional arg is the same as no arg
    if sounds == ["all"]:
        sounds = []

    return host, gap, volume, sounds


def main():
    host, gap, volume, sounds = parse_args()
    bar = BusyBar(host)

    # --- resolve sound list ---
    if not sounds:
        # fetch from the emulator's listing endpoint
        try:
            with urllib.request.urlopen(bar.base + "/api/_sounds", timeout=5) as r:
                manifest = json.loads(r.read())
            sounds = sorted(manifest.keys())
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            code = getattr(e, "code", None)
            if code == 404 or isinstance(e, urllib.error.URLError):
                print(
                    "error: /api/_sounds is not available on this host "
                    "(emulator-only endpoint).\n"
                    "Pass explicit sound names, e.g.:\n"
                    "  python3 apps/sound_test.py glass",
                    file=sys.stderr,
                )
            else:
                print(f"error: could not list sounds: {e}", file=sys.stderr)
            sys.exit(1)

        if not sounds:
            print("no sounds found in emulator manifest.", file=sys.stderr)
            sys.exit(1)

    # --- volume check / set ---
    cur_vol = bar.audio_volume().get("volume", 0)
    if volume is not None:
        bar.audio_volume(volume=volume)
        cur_vol = volume
    elif cur_vol == 0:
        print(
            "warning: device volume is 0 — sounds will be silent. "
            "Pass --volume 70 (or higher) to hear them.",
            file=sys.stderr,
        )

    total = len(sounds)
    print(f"sound_test → {bar.base}  ({total} sound(s), gap={gap}s)")

    try:
        for i, name in enumerate(sounds, 1):
            print(f"{name}  {i}/{total}")

            # long names scroll across the full width
            bar.display_draw(APP, [
                text(name, x=0, y=5,
                     scroll_rate=600, scroll_start_delay=500, scroll_repeat_delay=800),
            ])

            bar.audio_play(APP, stock_path=name)
            time.sleep(gap)

    except KeyboardInterrupt:
        print("\nstopped.")
        bar.display_clear(APP)
        sys.exit(0)

    bar.display_clear(APP)
    sys.exit(0)


if __name__ == "__main__":
    main()
