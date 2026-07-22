"""BUSY Bar HTTP client (stdlib only): matches the real device API.

Endpoints/verbs mirror the firmware (busybar-firmware/web_server): clear is
DELETE /api/display/draw, brightness is a single ?value=, uploads are raw bytes
with ?file=, etc. An app written against this runs unchanged against the bar by
swapping the host.

    from busybar import BusyBar, text, image, animation
    bar = BusyBar()                       # http://127.0.0.1:8080
    bar.display_draw("my.app", [text("HI", x=36, y=8, font="extra_large", align="center")])
"""
import json
import time
import urllib.request
import urllib.error
import urllib.parse

_ID = [0]


def _next_id():
    _ID[0] += 1
    return "e%d" % _ID[0]


# Device fonts (api_display.c): tiny small normal condensed bold large extra_large global.
FONTS = ("tiny", "small", "normal", "condensed", "bold", "large", "extra_large", "global")
ALIGNS = ("top_left", "top_mid", "top_right", "mid_left", "center", "mid_right",
          "bottom_left", "bottom_mid", "bottom_right")


def text(txt, x=0, y=0, font="normal", color="0xFFFFFFFF", align=None, width=None,
         scroll_rate=None, scroll_start_delay=None, scroll_repeat_delay=None,
         timeout=None, display_until=None, id=None, display="front"):
    """Text element. color=0xRRGGBBAA. scroll_rate = pixel-columns/minute (0=off).
    timeout is in SECONDS. align ∈ ALIGNS anchors the element box at (x,y)."""
    el = {"id": id or _next_id(), "type": "text", "text": str(txt), "x": x, "y": y,
          "font": font, "color": color, "display": display}
    for k, v in (("align", align), ("width", width), ("scroll_rate", scroll_rate),
                 ("scroll_start_delay", scroll_start_delay),
                 ("scroll_repeat_delay", scroll_repeat_delay),
                 ("timeout", timeout), ("display_until", display_until)):
        if v is not None:
            el[k] = v
    return el


def image(path=None, x=0, y=0, stock_path=None, opacity=None, color=None, align=None,
          id=None, display="front"):
    """Image element. Use `path` for an uploaded asset ('app/file.png') OR
    `stock_path` for a builtin ('faces/emoji-grinning' | sun|cloud|heart|check|bolt).
    The real device ignores `color` on images; the emulator uses it only to tint
    its 5 monochrome builtin icons."""
    el = {"id": id or _next_id(), "type": "image", "x": x, "y": y, "display": display}
    if path is not None:
        el["path"] = path
    if stock_path is not None:
        el["stock_path"] = stock_path
    if opacity is not None:
        el["opacity"] = opacity
    if color is not None:
        el["color"] = color
    if align is not None:
        el["align"] = align
    return el


def animation(name, x=0, y=0, opacity=None, section=None, loop=None, align=None, id=None):
    """Animation element. `name` = stock animation ('coding_72x16', 'indicator_busy_72x16')."""
    el = {"id": id or _next_id(), "type": "animation", "stock_path": name, "x": x, "y": y}
    for k, v in (("opacity", opacity), ("section", section), ("loop", loop), ("align", align)):
        if v is not None:
            el[k] = v
    return el


def rectangle(x, y, width, height, radius=None, border_width=None, border_color=None,
              fill=None, fill_colors=None, align=None, id=None, display="front"):
    """Rectangle element. fill ∈ none|solid|gradient_h|gradient_v."""
    el = {"id": id or _next_id(), "type": "rectangle", "x": x, "y": y,
          "width": width, "height": height, "display": display}
    for k, v in (("radius", radius), ("border_width", border_width),
                 ("border_color", border_color), ("fill", fill),
                 ("fill_colors", fill_colors), ("align", align)):
        if v is not None:
            el[k] = v
    return el


def countdown(timestamp, x=0, y=0, direction="time_left", show_hours="when_non_zero",
              color="0xFFFFFFFF", align=None, id=None, display="front"):
    """Countdown element (device renders it in busy_superscript_7). timestamp = unix epoch."""
    el = {"id": id or _next_id(), "type": "countdown", "x": x, "y": y,
          "timestamp": str(timestamp), "direction": direction,
          "show_hours": show_hours, "color": color, "display": display}
    if align is not None:
        el["align"] = align
    return el


class BusyBarError(RuntimeError):
    pass


class BusyBar:
    def __init__(self, host="127.0.0.1:8080", timeout=5.0):
        host = host.replace("http://", "").replace("https://", "").rstrip("/")
        self.base = "http://" + host
        self.timeout = timeout

    def _req(self, method, path, query=None, body=None, raw=None,
             ctype="application/octet-stream"):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data, headers = None, {}
        if raw is not None:
            data, headers["Content-Type"] = raw, ctype
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                payload = r.read()
                try:
                    return json.loads(payload) if payload else {}
                except ValueError:
                    return payload
        except urllib.error.HTTPError as e:
            raise BusyBarError(f"{method} {path} → {e.code} {e.read().decode('utf-8', 'ignore')}") from e
        except urllib.error.URLError as e:
            raise BusyBarError(f"{method} {path} failed: {e}") from e

    # --- display ---
    def display_draw(self, application_name, elements, priority=None, led_notification_color=None):
        body = {"application_name": application_name, "elements": elements}
        if priority is not None:
            body["priority"] = priority
        if led_notification_color is not None:
            body["led_notification_color"] = led_notification_color
        return self._req("POST", "/api/display/draw", body=body)

    def display_clear(self, application_name=None):
        return self._req("DELETE", "/api/display/draw",
                         query={"application_name": application_name} if application_name else None)

    def display_brightness(self, value=None):
        """GET → {'value': 'auto'|'NN'}. Set with value ∈ 0..100 or 'auto'."""
        if value is None:
            return self._req("GET", "/api/display/brightness")
        return self._req("POST", "/api/display/brightness", query={"value": value})

    # --- audio ---
    def audio_play(self, application_name, path=None, stock_path=None):
        body = {"application_name": application_name}
        if path is not None:
            body["path"] = path
        if stock_path is not None:
            body["stock_path"] = stock_path
        return self._req("POST", "/api/audio/play", body=body)

    def audio_stop(self):
        return self._req("DELETE", "/api/audio/play")

    def audio_volume(self, volume=None, silent=None):
        if volume is None:
            return self._req("GET", "/api/audio/volume")
        return self._req("POST", "/api/audio/volume", query={"volume": volume, "silent": silent})

    # --- assets (raw octet-stream body, ?file=) ---
    def assets_upload(self, application_name, file, data):
        return self._req("POST", "/api/assets/upload",
                         query={"application_name": application_name, "file": file}, raw=data)

    def assets_delete(self, application_name):
        return self._req("DELETE", "/api/assets/upload", query={"application_name": application_name})

    # --- busy timer ---
    def busy_snapshot(self, snapshot=None):
        if snapshot is None:
            return self._req("GET", "/api/busy/snapshot")
        return self._req("PUT", "/api/busy/snapshot", body=snapshot)

    def busy_profile(self, slot, profile=None):
        if profile is None:
            return self._req("GET", f"/api/busy/profiles/{slot}")
        return self._req("PUT", f"/api/busy/profiles/{slot}", body=profile)

    # --- device ---
    def name(self, value=None):
        if value is None:
            return self._req("GET", "/api/name")
        return self._req("POST", "/api/name", body={"name": value})

    def status(self, sub=None):
        return self._req("GET", "/api/status" + (f"/{sub}" if sub else ""))

    def version(self):
        return self._req("GET", "/api/version")

    def time(self):
        return self._req("GET", "/api/time")

    def input(self, key):
        return self._req("POST", "/api/input", query={"key": key})


def run_loop(fn, interval=1.0):
    try:
        while True:
            fn()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nstopped.")


def host_from_argv(default="127.0.0.1:8080"):
    import sys
    if "--host" in sys.argv:
        i = sys.argv.index("--host")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default
