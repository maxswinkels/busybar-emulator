<p align="center">
  <img src=".github/logo.svg" width="112" alt="BUSY Bar" />
</p>

<h1 align="center">BUSY Bar Emulator</h1>

<p align="center">
  A local emulator for the Flipper <code>BUSY Bar</code>.<br>
  Build and test display apps before your hardware arrives, using the same HTTP API, fonts, animations and pixels as the real thing.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> &middot; <a href="#the-api">API</a> &middot; <a href="docs/ATTRIBUTION.md">Attribution</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/API-25.0.0-2B7FFF" alt="API" />
  <img src="https://img.shields.io/badge/web%20UI-Vue%203-42b883" alt="Vue 3" />
  <img src="https://img.shields.io/badge/server-zero--dependency%20Node-339933" alt="Server" />
  <img src="https://img.shields.io/badge/code-MIT-yellow" alt="License" />
</p>

<p align="center">
  <img src="docs/assets/hero.png" width="720" alt="BUSY Bar Emulator" />
</p>

---

> [!IMPORTANT]
> **Unofficial community project.** Built and maintained by [Max Swinkels](https://github.com/maxswinkels), **not** an official Flipper Devices / BUSY product, and not affiliated with, endorsed by, or supported by them. "BUSY Bar" remains their trademark. For the real hardware and official apps, visit **[busy.app](https://busy.app)**.

## Why

- **The hardware isn't here yet.** The BUSY Bar sells out fast, so this lets you build and test apps right now instead of waiting.
- **BUSY Bar apps are just HTTP calls.** The device exposes a clean REST API. An app you write against the emulator runs unchanged on the real hardware. Just swap the host.
- **What works here works there.** Fonts, animations, gamma, priority and conflict resolution all match the firmware, so there are no surprises when you move to a real bar.

## Quick start

```bash
git clone https://github.com/maxswinkels/busybar-emulator.git
cd busybar-emulator/web && npm install && npm run build && cd ..
node server.js
# → http://127.0.0.1:8080
```

Then drive it like the real device:

```bash
python3 apps/clock.py              # big clock in the real device font
python3 apps/busy_status.py coding # plays the real "coding" theme animation
python3 apps/weather.py            # uploads an icon asset + draws a temperature
python3 apps/sound_test.py         # plays every stock sound in order (emulator lists them automatically)
python3 apps/pixel_fire.py         # demoscene fire on the LEDs (also: rain, plasma)
python3 apps/mac_monitor.py        # CPU / RAM / network bars from your Mac
```

> [!TIP]
> Take any real BUSY Bar example script, point its host at `127.0.0.1:8080`, and it just works. The API is identical, right down to accepting `app_id`.

## Features

- **Firmware-faithful HTTP API**: exact paths, verbs, response shapes and error codes (incl. 409 priority conflicts and `X-API-Token` auth), api_semver 25.0.0
- **Pixel-perfect text**: the device's real TTF fonts, baked to a 1-bpp glyph atlas with `lv_font_conv` using the firmware's own parameters
- **Real 72×16 animations**: all 12 status themes plus effects, imported straight from the firmware
- **Complete stock icon set**: 66 draw-tool icons, referenced exactly like the device (`faces/emoji-grinning`, `sun`, `heart`, …)
- **Authentic LED look**: square pixels, front-panel gamma (0.35) and a grayscale back OLED
- **WYSIWYG draw tool**: place text, rectangles and icons on the 72×16 grid with the device's exact fonts, pushed live to the bar
- **Web UI ported from the device**: Vue 3 frontend with the BUSY logo, device illustration and the Network / Firmware / Settings / Draw tabs

## Draw tool

Edit text, rectangles and stock icons right on the 72×16 canvas, with the same fonts and pixels as the device screen, pushed live to the bar in real time.

## The API

Success responses are `{"result":"OK"}` and errors are `{"error","code"}`. Auth mirrors the device: `X-API-Token` is only enforced for non-localhost callers when `BUSY_API_TOKEN` is set. Localhost is always allowed.

```bash
curl -s -X POST localhost:8080/api/display/draw -H 'content-type: application/json' -d '{
  "application_name":"cli","priority":50,
  "elements":[{"id":"t","type":"text","text":"HELLO","x":36,"y":8,
               "font":"extra_large","align":"center","color":"0x2B7FFFFF"}]}'
```

<details>
<summary>Endpoints &amp; element schema</summary>

| Method &amp; path | Purpose |
|---|---|
| `POST /api/display/draw` | Draw a frame: `{application_name, priority(1–100), elements[]}` → 409 if priority too low |
| `DELETE /api/display/draw?application_name=` | Clear (omit query to clear all) |
| `GET/POST /api/display/brightness?value=auto\|0-100` | Single brightness value |
| `POST /api/audio/play` · `DELETE /api/audio/play` · `GET/POST /api/audio/volume?volume=` | Sound |
| `POST /api/assets/upload?application_name=&file=` · `DELETE …` | PNG assets |
| `POST/GET/DELETE /api/storage/{write,read,list,mkdir,remove,rename,status}?path=` | Key/value store |
| `GET/PUT /api/busy/snapshot` · `GET/PUT /api/busy/profiles/{busy\|custom}` | BUSY timer/status |
| `GET/POST /api/name` · `GET /api/time` · `/api/time/{timestamp,timezone,tzlist}` | Device name / clock |
| `GET /api/status[/{device,firmware,system,power}]` | Nested status, `uptime` as a string |
| `GET /api/version` → `{"api_semver":"25.0.0"}` · `GET /api/transport` · `GET/POST /api/access` | Meta |
| `POST /api/input?key=` · `POST /api/log_dump` | Buttons / logs |
| `GET /api/_animations` | *(emulator)* imported-animation manifest with `fps`/`sections` |
| `GET /api/_sounds` | *(emulator)* stock-sound manifest `{name: filename}` (used by `sound_test.py`) |
| `GET /api/_apps` | *(emulator)* list runnable example apps + current app state/output |
| `POST /api/_apps/start` | *(emulator)* `{name, args?}`, spawn an app (stops any running app first) |
| `POST /api/_apps/stop` | *(emulator)* stop the running app → `{stopped:bool}` |
| `GET /api/_scenario` | *(emulator)* scenario state: power override, offline window, steal ownership |
| `POST /api/_scenario/power` | *(emulator)* `{battery_charge?, state?}` set battery % / charging state (shown in `/api/status/power`) |
| `POST /api/_scenario/offline` | *(emulator)* `{duration_ms}` reset all non-emulator `/api/*` connections for the window; call again to restore early |
| `POST /api/_scenario/steal` | *(emulator)* `{priority?=99, duration_ms?}` draw a high-priority frame so lower-priority draws get 409 |
| `POST /api/_scenario/reset` | *(emulator)* clear all scenario overrides |

```jsonc
// text: colour 0xRRGGBBAA (default 0xFFFFFFFF)
{ "id":"a","type":"text","text":"BUSY","x":36,"y":8,"align":"center",
  "font":"tiny|small|normal|condensed|bold|large|extra_large|global",
  "width":62,"scroll_rate":600,"scroll_start_delay":500,"scroll_repeat_delay":1000 }

// image: path (uploaded) OR stock_path ('faces/emoji-grinning', or sun|cloud|heart|check|bolt)
{ "id":"b","type":"image","x":1,"y":0,"stock_path":"faces/emoji-grinning","opacity":100 }

// animation: a device animation folder name
{ "id":"c","type":"animation","stock_path":"coding_72x16","x":0,"y":0,"section":"default","loop":true }

// rectangle: fill none|solid|gradient_h|gradient_v
{ "id":"d","type":"rectangle","x":56,"y":9,"width":15,"height":6,
  "border_width":1,"border_color":"0xFFB000FF","fill":"gradient_h","fill_colors":["0xFF3C3CFF","0x2B7FFFFF"] }
```

Common fields: `id` (required), `type` (required), `x`, `y`, `align` (`top_left` … `center` … `bottom_right`), `timeout` (seconds), `display_until` (unix epoch), `display` (`front`/`back`).

</details>

## Point it at real hardware

```python
bar = BusyBar("10.0.4.20")   # USB-ethernet or the bar's Wi-Fi IP
```

Same fonts, alignment, colors, scrolling, stock icons, timeouts, priority and asset uploads. It all follows the device's HTTP API.

## Architecture

```
┌── apps (Python) ──┐   POST /api/display/draw    ┌── server.js (Node) ──┐   SSE   ┌── browser ──┐
│ clock, weather,   │  ─────────────────────────▶ │ mock BUSY Bar API +  │ ──────▶ │ LED display │
│ ping, deploy …    │                             │ device state         │         │ (renderer)  │
└───────────────────┘                             └──────────────────────┘         └─────────────┘
```

`web/` is a Vite/Vue 3 frontend, built to `web/dist` and served by `server.js`. `tools/` holds the font-atlas bake process (see `tools/README.md`).

<details>
<summary>Fidelity notes</summary>

- **Rendering is a faithful approximation.** Assets decode in the browser (1 image pixel = 1 LED), the front display applies gamma 0.35, and the back OLED is grayscale. `busy_tiny` is bitmap-only and falls back to `busy_regular_5px`.
- **Priority/409 matches the firmware's core rule.** The current owner may redraw at equal priority; a different app needs strictly higher priority to take the screen (else 409). Not emulated: the real device may defer a conflicting request for up to 1.5 s, merges same-app elements by `id`, and expires elements via per-element timeouts.
- **Stubs or omitted.** Storage, audio, smart_home, wifi, update and BLE endpoints are simplified. `type:"animation"`, `/api/_animations`, `/api/_apps*` (app runner) and `/api/_scenario*` (scenario simulator) are emulator conveniences.

</details>

## Roadmap

The goal is the fastest way to build, test and show off BUSY Bar apps, with or without hardware.

**Playground &amp; testing**

- [ ] **API console**: a request builder for every `/api/*` endpoint, with live responses and replay (the draw tool, generalized)
- [x] **Scenario simulator**: trigger the conditions apps must handle, like low battery, USB/Wi-Fi drop, button presses, and a higher-priority app stealing the screen (so you can test your 409 handling)
- [ ] **Multi-app sandbox**: run several apps at once and watch priority decide who owns the screen
- [ ] **Record &amp; replay**: capture an app's calls and scrub the timeline to debug animation timing

**Fidelity**

- [ ] **Screen stream (`/api/screen`)**: serve the real framebuffer so the official web app and third-party tools can target the emulator
- [ ] **Back OLED (160×80)**: render `display:"back"` elements
- [x] **Audio playback**: play stock and uploaded sounds, with a beep fallback

**SDK &amp; distribution**

- [ ] **Published clients**: the Python client on PyPI and a TypeScript client on npm, mirroring the official libraries
- [ ] **`npx busybar-emulator`**: run with no build step, plus a Docker image
- [ ] **App templates**: `create-busybar-app` starters (clock, status, monitor)
- [x] **Persistent state**: storage and uploaded assets survive restarts

**Content creation**

- [ ] **Animation editor**: build and export frame-by-frame 72×16 animations in the device format
- [x] **Copy as code**: export any draw-tool composition as a ready-to-paste `draw` payload (Python / curl / JSON)
- [ ] **Status gallery**: save, browse and re-push compositions like the device does

## Get the real thing

This is only an emulator. The BUSY Bar itself is a lovely piece of hardware built by [Flipper Devices](https://busy.app). If this project is useful to you, support the makers and grab one:

<a href="https://busy.app"><strong>busy.app →</strong></a>

## License

Code is [MIT](LICENSE). Bundled fonts, animations, icons and device artwork are © Flipper Devices, from the open-source [firmware](https://github.com/busy-app/busybar-firmware) under CC-BY 4.0 (graphics) and SIL OFL 1.1 (fonts). See [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md) for the details.

"BUSY Bar" is a trademark of Flipper Devices. This project is unaffiliated and unofficial.

## Author

**Max Swinkels**
