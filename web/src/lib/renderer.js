/* BUSY Bar LED renderer (module). createRenderer(matrixCanvas, oledCanvas, getModel, getStamp)
   → { start(), beep() }. Real device fonts (baked glyph atlas), real draw schema,
   animations with sections, stock SVG icons, front gamma, grayscale OLED. */
import { loadAtlas, rasterize, spaceWidth } from "./atlas.js";

export function createRenderer(cv, ocv, getModel, getStamp) {
  const W = 72, H = 16;
  loadAtlas();

  // TTF FontFaces are still loaded for the Konva draw-tool editor (matrix text
  // itself renders from the baked glyph atlas below, not from these).
  const FONT_FILES = {
    busy_regular_5px: "/public/fonts/busy_regular_5px.ttf", busy_regular_7px: "/public/fonts/busy_regular_7px.ttf",
    busy_condensed_7px: "/public/fonts/busy_condensed_7px.ttf", busy_bold_7px: "/public/fonts/busy_bold_7px.ttf",
    busy_regular_9px: "/public/fonts/busy_regular_9px.ttf", busy_bold_10px: "/public/fonts/busy_bold_10px.ttf",
    LanaPixel: "/public/fonts/LanaPixel.ttf",
  };
  Promise.allSettled(Object.entries(FONT_FILES).map(async ([fam, url]) => {
    try { const ff = new FontFace(fam, `url(${url})`); await ff.load(); document.fonts.add(ff); } catch (_) {}
  }));


  const ctx = cv.getContext("2d");
  const PITCH = cv.width / W, R = PITCH * 0.34;
  const SQ = PITCH * 0.74, HS = SQ / 2;   // square-LED side + half (grid gap between)
  const buf = new Float32Array(W * H * 3);
  const off = document.createElement("canvas"); off.width = cv.width; off.height = cv.height;
  (function () { const o = off.getContext("2d"); o.fillStyle = "#080809"; o.fillRect(0, 0, off.width, off.height); o.fillStyle = "rgba(255,255,255,0.028)"; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o.fillRect((x + 0.5) * PITCH - HS, (y + 0.5) * PITCH - HS, SQ, SQ); })();
  // gamma 0.35 with a small linear leak: pure pow() crushes dim gradient shades
  // to 0, which then rendered as flat grey via the cell boost below
  const GAMMA_LUT = (() => { const g = 1 / 0.35, lut = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 255; lut[i] = 255 * (Math.pow(x, g) + 0.08 * x) / 1.08; } return lut; })();

  let clip = null;
  function px(x, y, r, g, b) { x |= 0; y |= 0; if (x < 0 || x >= W || y < 0 || y >= H) return; if (clip && (x < clip[0] || x > clip[1])) return; const i = (y * W + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; }
  function pxa(x, y, r, g, b, a) { if (a >= 1) return px(x, y, r, g, b); x |= 0; y |= 0; if (x < 0 || x >= W || y < 0 || y >= H) return; if (clip && (x < clip[0] || x > clip[1])) return; const i = (y * W + x) * 3; buf[i] = buf[i] * (1 - a) + r * a; buf[i + 1] = buf[i + 1] * (1 - a) + g * a; buf[i + 2] = buf[i + 2] * (1 - a) + b * a; }
  function clearBuf() { buf.fill(0); }
  function blitMask(m, ox, oy, r, g, b) { for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) px(ox + x, oy + y, r, g, b); }

  let bright = 0.8;
  function render() {
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(off, 0, 0); ctx.globalCompositeOperation = "lighter";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3; let r = GAMMA_LUT[buf[i] | 0] * bright, g = GAMMA_LUT[buf[i + 1] | 0] * bright, b = GAMMA_LUT[buf[i + 2] | 0] * bright;
      if (r < 2 && g < 2 && b < 2) continue;
      const cxp = (x + 0.5) * PITCH, cyp = (y + 0.5) * PITCH;
      // tight bloom that stays mostly inside the cell → distinct square pixels
      const gr = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, PITCH * 0.72);
      gr.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},0.42)`); gr.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cxp, cyp, PITCH * 0.72, 0, 7); ctx.fill();
      const k = 30 * Math.max(r, g, b) / 255;   // white-hot boost scales with intensity so dim pixels keep their hue
      ctx.fillStyle = `rgb(${Math.min(255, r + k) | 0},${Math.min(255, g + k) | 0},${Math.min(255, b + k) | 0})`; ctx.fillRect(cxp - HS, cyp - HS, SQ, SQ);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function parseColor(c) {
    if (c == null) return [255, 255, 255, 1];
    let s = String(c).trim().replace(/^0x/i, "").replace(/^#/, "");
    let r = 255, g = 255, b = 255, a = 255;
    if (s.length >= 6) { r = parseInt(s.slice(0, 2), 16); g = parseInt(s.slice(2, 4), 16); b = parseInt(s.slice(4, 6), 16); }
    if (s.length >= 8) a = parseInt(s.slice(6, 8), 16);
    return [r, g, b, a / 255];
  }
  const ALIGN = { top_left: [0, 0], top_mid: [0.5, 0], top_right: [1, 0], mid_left: [0, 0.5], center: [0.5, 0.5], mid_right: [1, 0.5], bottom_left: [0, 1], bottom_mid: [0.5, 1], bottom_right: [1, 1] };
  function anchor(el, w, h) { const a = ALIGN[el.align] || ALIGN.top_left; return [(el.x | 0) - Math.round(w * a[0]), (el.y | 0) - Math.round(h * a[1])]; }

  const ICONS = {
    sun: ["...#...", ".#.#.#.", "..###..", "###.###", "..###..", ".#.#.#.", "...#..."],
    cloud: ["..###..", ".#####.", "#######", "#######", "..###..", ".......", "......."],
    heart: [".##.##.", "#######", "#######", ".#####.", "..###..", "...#...", "......."],
    check: ["......#", ".....#.", "#...#..", ".#.#...", "..#....", ".......", "......."],
    bolt: ["...##..", "..##...", ".####..", "...##..", "..##...", "..#....", ".#....."],
  };
  function drawMonoIcon(name, x, y, r, g, b) { const ic = ICONS[name]; if (!ic) return false; for (let ry = 0; ry < ic.length; ry++) for (let rx = 0; rx < ic[ry].length; rx++) if (ic[ry][rx] === "#") px(x + rx, y + ry, r, g, b); return true; }

  const imgCache = {};
  function sampleImage(src, targetH) {
    const key = src + "|" + (targetH || 0); if (imgCache[key]) return imgCache[key];
    const rec = { ready: false, w: 0, h: 0, px: null }; imgCache[key] = rec;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { let w = img.naturalWidth || 16, h = img.naturalHeight || 16; if (targetH && h > targetH) { w = Math.max(1, Math.round(w * targetH / h)); h = targetH; } const c = document.createElement("canvas"); c.width = w; c.height = h; const cx = c.getContext("2d", { willReadFrequently: true }); cx.imageSmoothingEnabled = (w > 72 || h > 72); cx.drawImage(img, 0, 0, w, h); try { rec.px = cx.getImageData(0, 0, w, h).data; rec.w = w; rec.h = h; rec.ready = true; } catch (_) {} };
    img.src = src; return rec;
  }
  function drawImageEl(src, el, op, targetH) {
    const rec = sampleImage(src, targetH); if (!rec.ready) return;
    const [dx, dy] = anchor(el, rec.w, rec.h);
    for (let iy = 0; iy < rec.h; iy++) for (let ix = 0; ix < rec.w; ix++) { const o = (iy * rec.w + ix) * 4; const a = rec.px[o + 3] / 255 * op; if (a < 0.15) continue; pxa(dx + ix, dy + iy, rec.px[o], rec.px[o + 1], rec.px[o + 2], a); }
  }

  let ICON_INDEX = {};
  fetch("/public/icons.json").then((r) => r.json()).then((cats) => { for (const cat in cats) for (const ic of cats[cat]) { const url = "/public/icons/" + ic.path.replace(/^draw_tool\//, ""); const base = ic.fileName.replace(/\.svg$/, ""); ICON_INDEX[cat + "/" + base] = url; ICON_INDEX[base] = url; ICON_INDEX[ic.id] = url; } }).catch(() => {});

  let ANIM = {};
  fetch("/api/_animations").then((r) => r.json()).then((m) => { ANIM = m || {}; }).catch(() => {});
  const animCache = {};
  function ensureAnim(name) { if (animCache[name]) return animCache[name]; const meta = ANIM[name]; if (!meta) return null; return animCache[name] = { meta, imgs: new Array(meta.frames), data: new Array(meta.frames) }; }
  function frameFile(meta, idx) { const n = (meta.start || 0) + idx; const num = meta.pad ? String(n).padStart(meta.pad, "0") : String(n); return `${meta.prefix || "frame_"}${num}.png`; }
  function loadFrame(rec, name, idx) { if (rec.data[idx] || rec.imgs[idx]) return; const img = new Image(); rec.imgs[idx] = img; img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const cx = c.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0); try { rec.data[idx] = { w: c.width, h: c.height, px: cx.getImageData(0, 0, c.width, c.height).data }; } catch (_) {} }; img.src = `/animations/${name}/${frameFile(rec.meta, idx)}`; }
  function sectionRange(meta, section) { if (section) { const s = (meta.sections || []).find((x) => x.name === section); if (s) return [s.start, s.end]; } const def = (meta.sections || []).find((x) => x.name === "default"); if (def) return [def.start, def.end]; return [0, meta.frames - 1]; }
  function playAnim(name, el, t, start, op) {
    const rec = ensureAnim(name); if (!rec) return false;
    const [s0, s1] = sectionRange(rec.meta, el.section); const len = Math.max(1, s1 - s0 + 1), fps = rec.meta.fps || 30;
    let k = Math.floor((t - start) * fps); if (el.loop === false) k = Math.min(k, len - 1); else k = ((k % len) + len) % len;
    const idx = s0 + k;
    for (let j = 0; j < 12; j++) loadFrame(rec, name, s0 + ((k + j) % len));
    let fr = rec.data[idx]; if (!fr) { for (let back = 1; back < len && !fr; back++) fr = rec.data[s0 + ((k - back + len) % len)]; }
    if (!fr) return true;
    const [dx, dy] = anchor(el, fr.w, fr.h);
    for (let iy = 0; iy < fr.h; iy++) for (let ix = 0; ix < fr.w; ix++) { const o = (iy * fr.w + ix) * 4; const r = fr.px[o], g = fr.px[o + 1], b = fr.px[o + 2]; if (r + g + b < 8) continue; pxa(dx + ix, dy + iy, r, g, b, op); }
    return true;
  }

  function lerpC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }
  function drawRect(el) {
    const w = el.width | 0, h = el.height | 0; if (w <= 0 || h <= 0) return;
    const [dx, dy] = anchor(el, w, h); const fill = el.fill || "none";
    const fc = (el.fill_colors && el.fill_colors[0]) ? parseColor(el.fill_colors[0]) : null;
    const fc2 = (el.fill_colors && el.fill_colors[1]) ? parseColor(el.fill_colors[1]) : fc;
    if (fill !== "none" && fc) for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { let c = fc; if (fill === "gradient_h") c = lerpC(fc, fc2, w > 1 ? xx / (w - 1) : 0); else if (fill === "gradient_v") c = lerpC(fc, fc2, h > 1 ? yy / (h - 1) : 0); pxa(dx + xx, dy + yy, c[0], c[1], c[2], c[3]); }
    const bw = el.border_width == null ? 1 : el.border_width | 0;
    if (bw > 0) { const [br, bg, bb, ba] = el.border_color ? parseColor(el.border_color) : [255, 255, 255, 1]; for (let k = 0; k < bw; k++) for (let xx = 0; xx < w; xx++) { pxa(dx + xx, dy + k, br, bg, bb, ba); pxa(dx + xx, dy + h - 1 - k, br, bg, bb, ba); } for (let k = 0; k < bw; k++) for (let yy = 0; yy < h; yy++) { pxa(dx + k, dy + yy, br, bg, bb, ba); pxa(dx + w - 1 - k, dy + yy, br, bg, bb, ba); } }
  }
  function drawCountdown(el, nowUnix) {
    const ts = parseInt(el.timestamp, 10) || 0; let sec = el.direction === "time_since" ? nowUnix - ts : ts - nowUnix; if (sec < 0) sec = 0;
    const hh = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = Math.floor(sec % 60);
    const showH = el.show_hours === "always" || hh > 0;
    const str = (showH ? String(hh).padStart(2, "0") + ":" : "") + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    const [r, g, b] = parseColor(el.color || "0xFFFFFFFF"); const m = rasterize(str, "bold"); if (!m) return;
    const [dx, dy] = anchor(el, m.w, m.h); blitMask(m, dx, dy, r, g, b);
  }

  const scrollState = new Map();
  let DT = 0;
  function drawFrame(elements, t, frameStamp, appName) {
    const nowUnix = Date.now() / 1000, age = t - frameStamp, seen = new Set();
    for (let idx = 0; idx < elements.length; idx++) {
      const el = elements[idx]; if (!el || typeof el !== "object") continue;
      if (el.display === "back") continue;
      if (el.timeout && age > el.timeout) continue;
      if (el.display_until && nowUnix > +el.display_until) continue;
      const op = el.opacity == null ? 1 : Math.max(0, Math.min(1, el.opacity / 100));
      if (el.type === "animation") { playAnim(el.stock_path || el.name || el.path, el, t, frameStamp, op); continue; }
      if (el.type === "rectangle") { drawRect(el); continue; }
      if (el.type === "countdown") { drawCountdown(el, nowUnix); continue; }
      if (el.type === "image" || el.path || el.stock_path) {
        if (el.stock_path && ANIM[el.stock_path]) { playAnim(el.stock_path, el, t, frameStamp, op); continue; }
        if (el.stock_path) { const url = ICON_INDEX[el.stock_path] || ICON_INDEX[el.stock_path.split("/").pop()]; if (url) { drawImageEl(url, el, op, 14); continue; } const [r, g, b] = parseColor(el.color || "0xFFFFFFFF"); if (drawMonoIcon(el.stock_path, el.x | 0, el.y | 0, r, g, b)) continue; }
        if (el.path && ICONS[el.path]) { const [r, g, b] = parseColor(el.color || "0xFFFFFFFF"); drawMonoIcon(el.path, el.x | 0, el.y | 0, r, g, b); continue; }
        if (el.path) drawImageEl("/assets/" + el.path, el, op);
        continue;
      }
      const [r, g, b] = parseColor(el.color || "0xFFFFFFFF");
      const txt = String(el.text == null ? "" : el.text);
      const m = rasterize(txt, el.font); if (!m) continue;
      if (el.scroll_rate > 0) {
        const a = ALIGN[el.align] || ALIGN.top_left;
        const boxW = el.width ? el.width : (W - (el.x | 0));
        const bx = (el.x | 0) - Math.round(boxW * a[0]); const by = (el.y | 0) - Math.round(m.h * a[1]);
        if (m.w <= boxW) { clip = [bx, bx + boxW - 1]; blitMask(m, bx, by, r, g, b); clip = null; }
        else {
          const gap = Math.max(3, spaceWidth(el.font) * 3), fullW = m.w + gap, pxPerSec = el.scroll_rate / 60;
          const key = (appName || "") + "|" + (el.id != null ? el.id : "#" + idx) + "|" + txt + "|" + boxW; seen.add(key);
          let st = scrollState.get(key); if (!st) { st = { off: 0, born: t, pauseUntil: 0 }; scrollState.set(key, st); }
          const startDelay = (el.scroll_start_delay || 0) / 1000, repeatDelay = (el.scroll_repeat_delay || 0) / 1000;
          if (t - st.born >= startDelay && t >= st.pauseUntil) { st.off += pxPerSec * DT; if (st.off >= fullW) { st.off -= fullW; if (repeatDelay > 0) st.pauseUntil = t + repeatDelay; } }
          const o = Math.floor(st.off); clip = [bx, bx + boxW - 1]; blitMask(m, bx - o, by, r, g, b); blitMask(m, bx - o + fullW, by, r, g, b); clip = null;
        }
      } else {
        const [dx, dy] = anchor(el, m.w, m.h);
        if (el.width) { clip = [dx, dx + el.width - 1]; blitMask(m, dx, dy, r, g, b); clip = null; } else blitMask(m, dx, dy, r, g, b);
      }
    }
    if (scrollState.size > 40) for (const k of scrollState.keys()) if (!seen.has(k)) scrollState.delete(k);
  }

  let idleOff = 0;
  function drawIdle(t, connected) {
    const msg = connected ? "   BUSY BAR · WAITING FOR /API/DISPLAY/DRAW   " : "   NO SIGNAL · START THE SERVER   ";
    const m = rasterize(msg, "normal"); if (!m) return;
    const gap = 8, fullW = m.w + gap; idleOff = (idleOff + 20 * DT) % fullW; const o = Math.floor(idleOff);
    const c = connected ? [70, 80, 92] : [150, 40, 40];
    blitMask(m, -o, 5, c[0], c[1], c[2]); blitMask(m, -o + fullW, 5, c[0], c[1], c[2]);
  }

  const octx = ocv.getContext("2d");
  function drawOled(model) {
    octx.fillStyle = "#050505"; octx.fillRect(0, 0, 160, 80); octx.textBaseline = "top";
    const mono = getComputedStyle(document.body).getPropertyValue("--mono");
    octx.fillStyle = "#e8e8e8"; octx.font = "700 9px " + mono; octx.fillText((model.name || "BUSY BAR").slice(0, 16), 6, 6); octx.fillRect(6, 18, 148, 1);
    const d = new Date(); octx.font = "700 30px " + mono; octx.fillStyle = "#f4f4f4"; octx.fillText(String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), 8, 26);
    octx.font = "600 10px " + mono; octx.fillStyle = "#bdbdbd"; octx.fillText("> " + (model.frame.application_name || "IDLE").toUpperCase().slice(0, 16), 6, 62);
    octx.strokeStyle = "#666"; octx.lineWidth = 1; octx.strokeRect(132, 6, 20, 9); octx.fillStyle = "#666"; octx.fillRect(152, 8, 2, 5);
    const bw = Math.max(1, Math.round(14 * (model.battery_charge || 0) / 100)); octx.fillStyle = "#cfcfcf"; octx.fillRect(134, 8, bw, 5);
  }

  let actx = null;
  function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18); o.stop(actx.currentTime + 0.2); } catch (_) {} }

  let last = performance.now() / 1000, oledTick = 0, running = false;
  function frame(now) {
    if (!running) return;
    const t = now / 1000; DT = Math.min(0.1, t - last); last = t;
    const model = getModel(), stamp = getStamp();
    const bv = model.brightness; bright = (bv === "auto" || bv == null ? 80 : bv) / 100;
    clearBuf();
    const els = (model.frame && model.frame.elements) || [];
    if (els.length) drawFrame(els, t, stamp, model.frame.application_name); else drawIdle(t, model.connected);
    render();
    oledTick += DT; if (oledTick > 0.25) { drawOled(model); oledTick = 0; }
    requestAnimationFrame(frame);
  }
  return { start() { if (running) return; running = true; requestAnimationFrame(frame); }, stop() { running = false; }, beep };
}
