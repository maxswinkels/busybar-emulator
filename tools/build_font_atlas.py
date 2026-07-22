#!/usr/bin/env python3
"""Build a glyph atlas JSON from lv_font_conv --format dump output.

Output: { font: { ascent, descent, lineh, glyphs: { "<code>": {adv, ox, oy, w, h, rows:[hex]} } } }
rows = one hex string per row, MSB = leftmost pixel. oy = top offset from line top.
"""
import json
import os
import struct
import sys
import zlib


def decode_png(path):
    """Minimal PNG decoder (8-bit gray/RGB/RGBA/palette, all filters)."""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, w, h, bitd, ctype, idat, plte = 8, 0, 0, 0, 0, b"", b""
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4]); tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]; pos += 12 + ln
        if tag == b"IHDR":
            w, h, bitd, ctype = struct.unpack(">IIBB", chunk[:10])
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"PLTE":
            plte = chunk
        elif tag == b"IEND":
            break
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    assert bitd == 8, f"bitdepth {bitd} unsupported"
    stride = w * nch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for x in range(stride):
            a = line[x - nch] if x >= nch else 0
            b = prev[x]
            c = prev[x - nch] if x >= nch else 0
            if f == 1: line[x] = (line[x] + a) & 0xFF
            elif f == 2: line[x] = (line[x] + b) & 0xFF
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    # luminance per pixel
    lum = []
    for y in range(h):
        row = []
        for x in range(w):
            o = y * stride + x * nch
            if ctype == 3:
                idx = out[o] * 3
                v = (plte[idx] + plte[idx + 1] + plte[idx + 2]) // 3 if idx + 2 < len(plte) else 0
            elif nch >= 3:
                v = (out[o] + out[o + 1] + out[o + 2]) // 3
            else:
                v = out[o]
            row.append(v)
        lum.append(row)
    return w, h, lum


def ink_trim(lum, w, h):
    """Dump PNGs are black glyph on white canvas with margins: invert + trim to ink bbox."""
    ink = [[1 if lum[y][x] < 128 else 0 for x in range(w)] for y in range(h)]
    xs = [x for y in range(h) for x in range(w) if ink[y][x]]
    ys = [y for y in range(h) for x in range(w) if ink[y][x]]
    if not xs:
        return 0, 0, []
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return x1 - x0 + 1, y1 - y0 + 1, [row[x0:x1 + 1] for row in ink[y0:y1 + 1]]


def rows_hex(ink, w):
    res = []
    for row in ink:
        bits = 0
        for x in range(w):
            bits = (bits << 1) | row[x]
        pad = (-w) % 8
        res.append(format(bits << pad, "0{}x".format((w + pad + 3) // 4)))
    return res


def build(dirpath):
    info = json.load(open(os.path.join(dirpath, "font_info.json")))
    ascent, descent = info["ascent"], info["descent"]
    lineh = ascent - descent
    glyphs = {}
    for g in info["glyphs"]:
        code = g["code"]
        adv = round(g["advanceWidth"])
        png = os.path.join(dirpath, format(code, "x") + ".png")
        bb = g["bbox"]
        if not os.path.exists(png) or bb["width"] <= 1 and bb["height"] <= 1 and code == 32:
            glyphs[str(code)] = {"adv": adv, "ox": 0, "oy": 0, "w": 0, "h": 0, "rows": []}
            continue
        w, h, lum = decode_png(png)
        iw, ih, ink = ink_trim(lum, w, h)
        # bbox: x = left bearing, y = bottom offset from baseline (LVGL style)
        ox = bb["x"]
        top = ascent - (bb["y"] + bb["height"])
        glyphs[str(code)] = {"adv": adv, "ox": ox, "oy": top, "w": iw, "h": ih, "rows": rows_hex(ink, iw)}
    return {"ascent": ascent, "descent": descent, "lineh": lineh, "glyphs": glyphs}


FONTS = ["tiny", "small", "normal", "condensed", "bold", "large", "extra_large", "global"]
atlas = {}
for f in FONTS:
    d = "d_" + f
    if os.path.isdir(d):
        atlas[f] = build(d)
        print(f, "ok:", len(atlas[f]["glyphs"]), "glyphs, lineh", atlas[f]["lineh"])
out = sys.argv[1] if len(sys.argv) > 1 else "font-atlas.json"
json.dump(atlas, open(out, "w"), separators=(",", ":"))
print("wrote", out, os.path.getsize(out), "bytes")
