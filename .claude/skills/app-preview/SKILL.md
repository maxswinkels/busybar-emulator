---
name: app-preview
description: Run an app in the emulator and capture a 720×160 preview PNG or GIF of the LED display (busybar-apps gallery format), saved to a local file. Takes the app name plus optional --gif [seconds] and --out <path>.
disable-model-invocation: true
---

# Capture an app preview

Automates what the Preview panel's PNG/Rec buttons do by hand: run an app,
capture the matrix canvas at 720×160 (72×16 LEDs × 10 px, the busybar-apps
CONTRIBUTING.md format), and save the result as a file. Rendering happens in a
real browser via Playwright, so the preview is pixel-identical to the UI.

Arguments: `<app-name> [app-args...] [--gif [seconds]] [--out <path>]`

- `<app-name>`: as listed by `GET /api/_apps` (e.g. `clock`, `busy_status`,
  `local/foo`). Anything between the app name and the flags is passed to the
  app as args (e.g. `busy_status coding`).
- `--gif [seconds]`: record a GIF (default 6 s, max 15 — the storage body cap
  is 8 MB) instead of a PNG snapshot.
- `--out <path>`: output file. Default `docs/assets/previews/<app>.png|.gif`
  (create the directory if needed; use basename only for `local/` apps).

## Steps

1. **Server.** Check `curl -sf http://127.0.0.1:8080/api/version`. If it is not
   up, start `node server.js` in the background and remember that you own it
   (stop it again in step 6). If `web/dist/` is missing, build it first:
   `npm --prefix web run build`.

2. **Start the app.** `POST /api/_apps/start` with
   `{"name": "<app-name>", "args": [...]}`. On a 404, fetch `GET /api/_apps`
   and show the user the available names. The launcher clears the display
   first, so whatever was on screen before does not leak into the capture.

3. **Open the UI.** Load the Playwright tools in ONE ToolSearch call
   (`select:mcp__playwright__browser_navigate,mcp__playwright__browser_evaluate,mcp__playwright__browser_close`),
   navigate to `http://127.0.0.1:8080`, then wait ~2 s so the SSE stream and
   the app's first frames have arrived (for slow-starting apps like `ping_monitor`,
   confirm via `GET /api/_apps` output that it is drawing before capturing).

4. **Capture.** Use `browser_evaluate` with the matching snippet from this
   skill's directory. Pass only the `async () => { ... }` arrow function as
   the `function` parameter — drop the leading `//` comment lines:
   - PNG: `capture_png.js` as-is.
   - GIF: `record_gif.js`, first replacing the `SECONDS = 6` literal if the
     user gave a duration. The evaluate call blocks for the full recording;
     that is expected.
   The snippet stores the result in emulator storage under `_preview.png` /
   `_preview.gif` and returns the byte size.

5. **Retrieve and clean up storage.**
   ```bash
   curl -sf -o <out> 'http://127.0.0.1:8080/api/storage/read?path=_preview.png'
   curl -sf -X DELETE 'http://127.0.0.1:8080/api/storage/remove?path=_preview.png'
   ```
   (same with `.gif`). The remove matters: storage persists to
   `.data/state.json` and must not accumulate preview blobs.

6. **Tear down.** `POST /api/_apps/stop`, close the browser tab, and stop the
   server if you started it in step 1.

7. **Verify and report.** Run `file <out>` and check it reports the right type
   and `720 x 160`. Report the saved path, dimensions, file size, and (for
   GIFs) the frame count returned by the snippet.

## Notes

- The GIF path imports gifenc from `esm.sh` inside the page, so it needs
  network access; the PNG path is fully offline.
- Captures storage keys are namespaced `_preview.*` and always removed; never
  leave them behind, even on failure.
- For busybar-apps gallery contributions, pass `--out` pointing at the app's
  folder in that repo; the format already matches its CONTRIBUTING.md.
