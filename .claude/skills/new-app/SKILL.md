---
name: new-app
description: Scaffold a new apps/<name>.py example app for the BUSY Bar emulator following the existing conventions (busybar client import, host_from_argv, display_draw, run_loop). Takes the new app's name as its argument.
disable-model-invocation: true
---

# Scaffold a new BUSY Bar app

Creates `apps/<name>.py`, a minimal but runnable app that drives the emulator
(or the real bar) through the `apps/busybar.py` stdlib client, following the
conventions of the existing apps (`apps/clock.py`, `apps/weather.py`).

The app name is given as the skill argument: `$ARGUMENTS`.

## Step 1: validate the name

- Take the name from `$ARGUMENTS`; strip a trailing `.py` if given.
  If no argument was provided, ask for a name.
- It must be a valid Python module name: lowercase, `snake_case`, no dashes.
- Refuse if `apps/<name>.py` already exists.

## Step 2: create `apps/<name>.py`

Use exactly this skeleton (replace `<name>` with the app name and `<NAME>`
with an uppercase display string). The import surface below is the real one
exported by `apps/busybar.py`, `BusyBar`, `text`, `image`, `animation`,
`rectangle`, `countdown`, `host_from_argv`, `run_loop`, import only what the
skeleton uses; add `image` / `animation` / `rectangle` / `countdown` later
as needed.

```python
#!/usr/bin/env python3
"""<Name>, one-line description of what this app shows.

    python3 apps/<name>.py [--host 127.0.0.1:8080]
"""
from busybar import BusyBar, text, host_from_argv, run_loop

APP = "demo.<name>"
bar = BusyBar(host_from_argv())


def tick():
    bar.display_draw(APP, [
        text("<NAME>", x=36, y=8, font="extra_large", align="center"),
    ])


if __name__ == "__main__":
    print(f"<name> → {bar.base}  (Ctrl-C to stop)")
    run_loop(tick, interval=1.0)
```

Conventions this encodes (keep them):

- **Resolve the host with `host_from_argv()`** so `--host <ip>` works, the same
  script then runs unchanged against real hardware.
- **`APP` is a namespaced application id** (`demo.<name>` for examples); it is the
  first argument to every `bar.display_draw(...)` call and scopes clearing and
  asset uploads.
- **Draw with `bar.display_draw(APP, [elements])`**: a full list of elements per
  frame. Pass `priority=<n>` if the app must win conflicts with other apps.
- **Center text on the 72x16 matrix** with `x=36, y=8, align="center"`, `align`
  anchors the element box at (x, y) so no text measuring is needed.
- **`run_loop(fn, interval=...)`** for apps that update on a timer (like clock);
  it handles the sleep loop and a clean Ctrl-C exit. A one-shot app can just call
  `tick()` once instead.
- Fonts are the device set: `tiny small normal condensed bold large extra_large global`.
  Colors are `0xRRGGBBAA` strings (e.g. `"0x2B7FFFFF"`).
- One-time setup (e.g. `bar.assets_upload(...)` for icons, as in `apps/weather.py`)
  goes in a `setup()` called from `__main__` before the loop.

## Step 3: tell the user how to run it

Remind the user:

- Against the local emulator (`npm start` must be running):
  `python3 apps/<name>.py`
- Against real hardware: `python3 apps/<name>.py --host <ip>`
- Stop with Ctrl-C; clear the app's elements with
  `bar.display_clear(APP)` (or restart the emulator).
