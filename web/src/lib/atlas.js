/* Shared device-font glyph atlas (baked 1-bpp bitmaps from the firmware TTFs).
   Used by BOTH the LED renderer and the draw-tool editor so text is identical. */
export const ATLAS_KEY = {
  tiny: "tiny", small: "small", normal: "normal", condensed: "condensed",
  bold: "bold", large: "large", extra_large: "extra_large", global: "global",
  medium: "normal", big: "extra_large",   // legacy aliases
};

let _atlas = null;
let _loading = null;
export function loadAtlas() {
  if (_atlas) return Promise.resolve(_atlas);
  if (!_loading) _loading = fetch("/public/fonts/font-atlas.json").then((r) => r.json()).then((a) => { _atlas = a; return a; }).catch(() => null);
  return _loading;
}
export function getAtlas() { return _atlas; }

const cache = new Map();
// -> { w, h, mask: Uint8Array (1 = lit), adv } in LED pixels, or null until loaded.
// Firmware-true vertical metrics per device font (from busy-app/busybar-firmware @1.1.1,
// where each .font is converted with --range 0-65535). Our atlas is baked ASCII-only, so
// its derived ascent/lineh are smaller; without this correction text renders too high.
// LVGL places a glyph top at y + ascent - box_h - ofs_y, so shifting by
// (fw_ascent - atlas_ascent) makes on-screen text land exactly like hardware.
// Each entry is [firmware_ascent, firmware_line_height].
const FW_METRICS = {
  tiny: [5, 6], small: [7, 9], normal: [9, 11], condensed: [9, 11],
  bold: [9, 11], large: [11, 13], extra_large: [12, 14], global: [8, 11],
};
export function rasterize(text, fontId) {
  const fk = ATLAS_KEY[fontId] || "normal";
  const font = _atlas && _atlas[fk];
  if (!font) return null;
  const fw = FW_METRICS[fk] || FW_METRICS.normal;
  const dyOff = fw[0] - (font.ascent || 0);
  const key = fk + "|" + text;
  const hit = cache.get(key); if (hit) return hit;
  const str = String(text);
  let pen = 0, maxRight = 0;
  const parts = [];
  for (const ch of str) {
    const g = font.glyphs[String(ch.codePointAt(0))] || font.glyphs["63"];
    if (!g) continue;
    parts.push([pen, g]);
    maxRight = Math.max(maxRight, pen + g.ox + g.w);
    pen += g.adv;
  }
  const w = Math.max(1, Math.max(pen, maxRight)), h = fw[1];
  const mask = new Uint8Array(w * h);
  for (const [px0, g] of parts) {
    for (let ry = 0; ry < g.h; ry++) {
      const hex = g.rows[ry]; if (!hex) continue;
      const bits = parseInt(hex, 16), total = hex.length * 4, yy = g.oy + dyOff + ry;
      if (yy < 0 || yy >= h) continue;
      for (let rx = 0; rx < g.w; rx++) {
        if ((bits >> (total - 1 - rx)) & 1) { const xx = px0 + g.ox + rx; if (xx >= 0 && xx < w) mask[yy * w + xx] = 1; }
      }
    }
  }
  const out = { w, h, mask, adv: pen };
  cache.set(key, out); return out;
}
export function spaceWidth(fontId) {
  const fk = ATLAS_KEY[fontId] || "normal";
  const f = _atlas && _atlas[fk], sp = f && f.glyphs["32"];
  return sp ? sp.adv : 4;
}
