#!/usr/bin/env python3
"""Smoke test for the BUSY Bar emulator.

Boots server.js on a free scratch port, exercises the core API surface,
prints one PASS/FAIL line per check, kills the server, and exits 0 only
if everything passed. Pure stdlib, no flags.

Covers: version, draw priority/409 arbitration (incl. app_id alias),
draw validation, display clear, sem-ver gate, brightness, storage
roundtrip, busy snapshot, and the app runner (start clock -> frame on
screen -> stop -> display released).

Note: the server persists storage to .data/state.json (shared with a dev
server, no env override). Every key this test writes is removed again.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

results = []


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    line = f"{'PASS' if ok else 'FAIL'}  {name}"
    if detail and not ok:
        line += f" — {detail}"
    print(line)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Api:
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}"

    def req(self, method, path, body=None, headers=None):
        """Returns (status, bytes). HTTP errors are results, not exceptions."""
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def jreq(self, method, path, body=None, headers=None):
        status, raw = self.req(method, path, body, headers)
        try:
            return status, json.loads(raw)
        except Exception:
            return status, None

    def snapshot(self):
        """First state event from /events (the SSE stream sends one immediately)."""
        with urllib.request.urlopen(self.base + "/events", timeout=5) as resp:
            for raw in resp:
                if raw.startswith(b"data: "):
                    return json.loads(raw[len(b"data: "):])
        return None

    def wait(self, pred, timeout=5.0, interval=0.2):
        """Polls pred() until truthy; returns its last value."""
        deadline = time.time() + timeout
        value = pred()
        while not value and time.time() < deadline:
            time.sleep(interval)
            value = pred()
        return value


def el(txt):
    return [{"id": "s1", "type": "text", "text": txt, "x": 0, "y": 8, "font": "normal"}]


def run_checks(api):
    # version
    status, body = api.jreq("GET", "/api/version")
    check("GET /api/version reports api_semver", status == 200 and body and "api_semver" in body,
          f"got {status} {body}")

    # draw arbitration (server rule: owner may redraw at equal priority,
    # a different app needs strictly higher priority)
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.a", "priority": 60, "elements": el("A")})
    check("draw: smoke.a takes the screen at priority 60", status == 200, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.a", "priority": 60, "elements": el("A2")})
    check("draw: owner may redraw at equal priority", status == 200, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.a", "priority": 59, "elements": el("A3")})
    check("draw: owner at lower priority gets 409", status == 409, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.b", "priority": 60, "elements": el("B")})
    check("draw: other app at equal priority gets 409", status == 409, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.b", "priority": 61, "elements": el("B")})
    check("draw: other app at higher priority takes over", status == 200, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"app_id": "smoke.b", "priority": 61, "elements": el("B2")})
    check("draw: app_id alias accepted (owner redraw)", status == 200, f"got {status}")

    # draw validation
    status, _ = api.jreq("POST", "/api/display/draw", {"priority": 50, "elements": el("X")})
    check("draw: missing application_name is 400", status == 400, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw", {"application_name": "smoke.v", "elements": []})
    check("draw: empty elements is 400", status == 400, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.v", "priority": 0, "elements": el("X")})
    check("draw: priority 0 is 400", status == 400, f"got {status}")

    # clear releases the screen for anyone
    status, _ = api.jreq("DELETE", "/api/display/draw")
    check("DELETE /api/display/draw clears", status == 200, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/draw",
                         {"application_name": "smoke.c", "priority": 1, "elements": el("C")})
    check("draw: priority 1 works on a cleared screen", status == 200, f"got {status}")
    api.jreq("DELETE", "/api/display/draw")

    # sem-ver gate (major != 25 -> 405; /api/version itself is exempt)
    status, _ = api.jreq("GET", "/api/time", headers={"X-API-Sem-Ver": "99.0.0"})
    check("sem-ver gate: major 99 gets 405", status == 405, f"got {status}")
    status, _ = api.jreq("GET", "/api/time", headers={"X-API-Sem-Ver": "25.1.0"})
    check("sem-ver gate: major 25 passes", status == 200, f"got {status}")
    status, _ = api.jreq("GET", "/api/version", headers={"X-API-Sem-Ver": "99.0.0"})
    check("sem-ver gate: /api/version is exempt", status == 200, f"got {status}")

    # brightness
    status, _ = api.jreq("POST", "/api/display/brightness?value=42")
    ok1 = status == 200
    status, body = api.jreq("GET", "/api/display/brightness")
    check("brightness: set 42, read back 42", ok1 and status == 200 and body == {"value": "42"},
          f"got {status} {body}")
    status, _ = api.jreq("POST", "/api/display/brightness?value=142")
    check("brightness: 142 is 400", status == 400, f"got {status}")
    status, _ = api.jreq("POST", "/api/display/brightness?value=auto")
    check("brightness: auto accepted", status == 200, f"got {status}")

    # storage roundtrip (namespaced, removed again below)
    payload = b"hello smoke"
    status, _ = api.jreq("POST", "/api/storage/write?path=_smoke/hello.txt", payload)
    check("storage: write", status == 200, f"got {status}")
    status, raw = api.req("GET", "/api/storage/read?path=_smoke/hello.txt")
    check("storage: read returns the bytes", status == 200 and raw == payload, f"got {status} {raw!r}")
    status, body = api.jreq("GET", "/api/storage/list?path=_smoke/")
    names = [i.get("name") for i in (body or {}).get("list", [])]
    check("storage: list finds the file", status == 200 and "_smoke/hello.txt" in names, f"got {status} {names}")
    status, _ = api.jreq("DELETE", "/api/storage/remove?path=_smoke/hello.txt")
    ok1 = status == 200
    status, _ = api.req("GET", "/api/storage/read?path=_smoke/hello.txt")
    check("storage: remove, then read is 400", ok1 and status == 400, f"got {status}")

    # busy snapshot
    status, body = api.jreq("GET", "/api/busy/snapshot")
    check("GET /api/busy/snapshot", status == 200 and isinstance(body, dict), f"got {status}")

    # app runner: start busy_status (a one-shot that draws a theme animation and
    # exits), expect its frame on screen, then stop and expect the display released.
    status, body = api.jreq("GET", "/api/_apps")
    apps = [a.get("name") for a in (body or {}).get("apps", [])]
    check("apps: /api/_apps lists busy_status", status == 200 and "busy_status" in apps, f"got {status} {apps}")
    status, body = api.jreq("POST", "/api/_apps/start", {"name": "busy_status", "args": ["coding"]})
    check("apps: start busy_status returns a pid", status == 200 and body and body.get("pid"), f"got {status} {body}")
    owner = api.wait(lambda: (api.snapshot() or {}).get("frame", {}).get("application_name") == "busy",
                     timeout=6.0)
    check("apps: busy_status frame reaches the display", bool(owner))
    status, _ = api.jreq("POST", "/api/_apps/stop")
    check("apps: stop", status == 200, f"got {status}")
    released = api.wait(lambda: not (api.snapshot() or {}).get("frame", {}).get("elements"), timeout=4.0)
    check("apps: display released after stop", bool(released))


def main():
    port = free_port()
    env = dict(os.environ, PORT=str(port))
    env.pop("BUSY_PYTHON", None)  # a dev override here would break the app-runner checks
    log = tempfile.NamedTemporaryFile(prefix="busybar-smoke-", suffix=".log", delete=False)
    try:
        proc = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    except FileNotFoundError:
        print("FAIL  node not found on PATH")
        return 1

    api = Api(port)
    try:
        up = api.wait(lambda: _probe(api), timeout=10.0)
        if not up:
            log.flush()
            with open(log.name) as f:
                tail = f.read()[-2000:]
            print(f"FAIL  server did not come up on :{port} within 10s\n--- server log ---\n{tail}")
            return 1
        print(f"emulator up on :{port} (log: {log.name})")
        run_checks(api)
    finally:
        try:
            api.jreq("POST", "/api/_apps/stop")  # never orphan a spawned app
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    passed, total = sum(results), len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


def _probe(api):
    try:
        return api.jreq("GET", "/api/version")[0] == 200
    except Exception:
        return False


if __name__ == "__main__":
    sys.exit(main())
