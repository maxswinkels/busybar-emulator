# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local emulator of the Flipper **BUSY Bar** (a 72×16 LED display device). The guiding principle: **the real firmware's HTTP API is the source of truth.** An app written against this emulator must run unchanged against real hardware by only swapping the host. When adding or changing an `/api/*` route, match the firmware's paths, verbs, response shapes, and error codes (`busybar-firmware/web_server`), don't invent conveniences unless clearly marked as emulator-only (e.g. `/api/_animations`, `type:"animation"`).

## Commands

```bash
# Build the web UI (required before first server run, server serves web/dist)
cd web && npm install && npm run build && cd ..

# Run the emulator (mock API + display) → http://127.0.0.1:8080
node server.js          # or: npm start

# Web UI hot-reload dev: run BOTH, then browse to :5173
node server.js                    # backend on :8080
npm --prefix web run dev          # Vite on :5173, proxies /api,/events,/animations,/assets,/public → :8080

# Drive the device like real hardware
python3 apps/clock.py
python3 apps/busy_status.py coding
python3 apps/<app>.py --host 10.0.4.20   # point any app at a different host (incl. a real bar)
```

- Env: `PORT` (default 8080), `BUSY_API_TOKEN` (when set, enforces `X-API-Token` for **non-localhost** callers only; localhost is always allowed).
- There is no test suite and no linter configured. `npm start` is the only npm script at the repo root.

## Architecture

Three tiers connected by the device's HTTP API and a one-way SSE stream:

```
apps/*.py  ──POST /api/display/draw──▶  server.js  ──SSE /events──▶  browser (Vue) renders LEDs
(client)                                (mock API + in-memory state)
```

- **`server.js`**: a single-file, **zero-dependency** Node HTTP server (stdlib only, keep it that way). Holds *all* device state in memory (`state` object: current frame, brightness, busy timer, storage, assets, log). Every mutating call updates state and `broadcast()`s a snapshot to all connected browsers over SSE. Also serves the built Vue app (`web/dist`) and static assets (`public/`). On boot it scans `public/animations/*/` into the `ANIMATIONS` manifest (detects frame naming, padding, fps/sections from optional `meta.json`). Priority/conflict: the current owner may redraw at equal priority; a different app needs strictly higher priority to take the screen (else `409`).

- **`web/`**: Vite + Vue 3 frontend. The LED display is drawn on a `<canvas>` by `web/src/lib/renderer.js`, which reads live state from `web/src/composables/useDevice.js` (subscribes to `/events`, exposes the reactive `device` object + `api`/`apiJson` helpers). **Text is rendered from a baked 1-bpp glyph atlas (`public/fonts/font-atlas.json`), not from TTFs**: this is what makes on-screen text pixel-identical to the hardware. `web/src/lib/atlas.js` (rasterize/spaceWidth) is shared by both the renderer and the Konva-based draw-tool editor so the two always agree. The loaded TTF `FontFace`s exist *only* for the draw-tool editor UI. Front display applies gamma 0.35; the back OLED is grayscale.

- **`apps/busybar.py`**: the stdlib-only Python client every example app imports (`BusyBar`, `text`/`image`/`animation`/`rectangle`/`countdown` element builders). Its method/verb layout mirrors the firmware, so it doubles as the reference for what the server must accept. The other `apps/*.py` are example apps built on it.

- **Font pipeline (`tools/`)**: `public/fonts/font-atlas.json` is generated: `lv_font_conv` dumps each firmware TTF to 1-bpp bitmaps, then `python3 tools/build_font_atlas.py` bakes them into the atlas. Rebuild it when device fonts change; see `tools/README.md` for exact `lv_font_conv` parameters (sizes, ranges).

## Conventions

- **Font names** are the device's set: `tiny small normal condensed bold large extra_large global` (see `FONTS` in `apps/busybar.py` and `ATLAS_KEY` in `web/src/lib/atlas.js`). Colors are `0xRRGGBBAA` strings.
- The draw payload accepts both `application_name` and `app_id` (community scripts use the latter), preserve that when touching the draw route.
- Bundled fonts/animations/icons/artwork are © Flipper Devices under CC-BY 4.0 / SIL OFL 1.1 (code is MIT). Keep `docs/ATTRIBUTION.md` accurate when adding or removing bundled assets.
