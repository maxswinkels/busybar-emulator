---
name: smoke
description: Boot the emulator on a scratch port and smoke-test the core API surface (draw priority/409 arbitration, app_id alias, sem-ver gate, brightness, storage roundtrip, app runner start/stop + display release). The repo has no test suite; this is the pre-commit sanity check. Use after any change to server.js or apps/busybar.py, or when asked to verify the emulator still works.
---

# Smoke-test the emulator

Runs the bundled deterministic test script. It boots `node server.js` on a free
scratch port (your dev server on :8080 can stay running), exercises the API,
prints one `PASS`/`FAIL` line per check, and tears everything down again.

## Run

```bash
python3 .claude/skills/smoke/smoke.py
```

Exit code 0 means all checks passed. Report the summary line to the user; on
success one sentence is enough.

## On failure

1. Quote the failing `FAIL` lines verbatim.
2. The script prints the server log path (`emulator up on :NNNN (log: ...)`) —
   read the log tail if the failure looks like a crash rather than a wrong
   response.
3. Investigate before touching anything: a FAIL after a `server.js` change
   usually means the change broke firmware-faithful behavior, not that the
   test is stale. The expectations encode the firmware rules (owner may redraw
   at equal priority; a different app needs strictly higher priority; sem-ver
   major must be 25). Only update the script when the intended API behavior
   genuinely changed — and then run the firmware-fidelity-reviewer agent on
   the server diff first.

## Notes

- Node and python3 are the only requirements; `web/dist` is not needed (API only).
- Storage persists to `.data/state.json`, which is shared with a dev server.
  The script namespaces its keys under `_smoke/` and removes them again.
- The app-runner checks launch `apps/clock.py` for a few seconds and verify
  the display is released after stop.
