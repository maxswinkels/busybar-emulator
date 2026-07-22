#!/usr/bin/env python3
"""Presence status: plays one of the real BUSY Bar theme animations and sets
the device's BUSY snapshot, exactly like choosing a status on the bar.

    python3 apps/busy_status.py on_air
    python3 apps/busy_status.py coding --host 127.0.0.1:8080

Themes (from the firmware, by picker order):
    keep_out dnd meeting on_call lunch back_soon
    booked flow chill_time on_air coding low_social_battery
"""
import sys
from busybar import BusyBar, animation, host_from_argv

# theme -> picker order (busy_theme resources)
THEMES = {
    "keep_out": 10, "dnd": 20, "meeting": 30, "on_call": 40, "lunch": 50, "back_soon": 60,
    "booked": 70, "flow": 80, "chill_time": 90, "on_air": 100, "coding": 110, "low_social_battery": 120,
}

theme = "on_air"
for a in sys.argv[1:]:
    if a in THEMES:
        theme = a

bar = BusyBar(host_from_argv())

# 1) draw the theme's real background animation (72x16)
bar.display_draw("busy", [animation(f"{theme}_72x16", x=0, y=0)])

# 2) set the BUSY snapshot with this theme (real envelope, INFINITE = "on until stopped")
bar.busy_snapshot({
    "snapshot": {
        "type": "INFINITE",
        "card_id": "00000000-0000-0000-0000-000000000000",
        "is_paused": False,
        "busy_bar_settings": {"theme": theme, "show_work_phase_only": False, "trigger_smart_home": True},
    },
    "snapshot_timestamp_ms": 0,
})

print(f"status '{theme}' set on {bar.base}")
