"use strict";
/*
 * BUSY Bar emulator: mock HTTP API + live display server.
 *
 * Routes match the real firmware (busybar-firmware/web_server): clear is
 * DELETE /api/display/draw, brightness is a single ?value=, uploads are raw
 * octet-stream with ?file=, status is nested, busy uses the real snapshot
 * envelope, and draws carry a 1-100 priority (409 on too-low). Auth mirrors the
 * device: only enforced for non-localhost callers when BUSY_API_TOKEN is set.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TOKEN = process.env.BUSY_API_TOKEN || null;
const PYTHON = process.env.BUSY_PYTHON || "python3";
const APPS_DIR = path.join(__dirname, "apps");
const PUBLIC = path.join(__dirname, "public");
const DIST = path.join(__dirname, "web", "dist");   // built Vue app
const ANIM_DIR = path.join(PUBLIC, "animations");
const API_SEMVER = "25.0.0";

/* --------------------------- animation manifest -------------------------- */
function scanAnimations() {
  const out = {};
  let dirs = [];
  try { dirs = fs.readdirSync(ANIM_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return out; }
  for (const d of dirs) {
    const dir = path.join(ANIM_DIR, d.name);
    let meta = { fps: 30, color_mode: "rgb888", sections: [] };
    try { Object.assign(meta, JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))); } catch (_) {}
    // Detect frame naming: <prefix><number>.png (frame_0.png OR coding_00000.png)
    let prefix = "frame_", pad = 0, start = 0, frames = 0;
    try {
      const nums = [];
      for (const f of fs.readdirSync(dir)) { const mm = f.match(/^(.*?)(\d+)\.png$/i); if (mm) nums.push({ p: mm[1], n: parseInt(mm[2], 10), w: mm[2].length }); }
      if (nums.length) {
        prefix = nums[0].p; frames = nums.length; start = nums.reduce((a, x) => Math.min(a, x.n), Infinity);
        pad = new Set(nums.map((x) => x.w)).size === 1 ? nums[0].w : 0;
      }
    } catch (_) {}
    const m = d.name.match(/(\d+)x(\d+)$/);
    out[d.name] = { name: d.name, fps: meta.fps || 30, frames, prefix, pad, start,
      color_mode: meta.color_mode || "rgb888", sections: Array.isArray(meta.sections) ? meta.sections : [],
      w: m ? +m[1] : 72, h: m ? +m[2] : 16 };
  }
  return out;
}
const ANIMATIONS = scanAnimations();

/* --------------------------------- apps ---------------------------------- */
const APP_PARAMS = {
  "busy_status.py": [{ key: "theme", label: "Theme", type: "select", positional: true, default: "on_air",
    options: ["keep_out","dnd","meeting","on_call","lunch","back_soon","booked","flow","chill_time","on_air","coding","low_social_battery"] }],
  "ping_monitor.py": [{ key: "target", label: "Target", type: "text", flag: "--target", placeholder: "8.8.8.8" }],
};

function scanApps() {
  let files = [];
  try { files = fs.readdirSync(APPS_DIR).filter((f) => f.endsWith(".py") && f !== "busybar.py" && !f.startsWith("_")); } catch (_) { return []; }
  return files.map((file) => {
    let description = file.replace(".py", "");
    try {
      const head = fs.readFileSync(path.join(APPS_DIR, file), "utf8").slice(0, 2048);
      const m = head.match(/"""[\s\n]*([^\n"]+)/);
      if (m) description = m[1].trim();
    } catch (_) {}
    return { name: file.replace(".py", ""), file, description, params: APP_PARAMS[file] || [] };
  });
}

let appProc = null;  // { child, name, pid, startedAt, exitCode, error, output, buf }
let appOpChain = Promise.resolve();
let appBcastTimer = null;

function appStatus() {
  if (!appProc) return { running: false, name: null, pid: null, startedAt: null, exitCode: null, error: null, output: [] };
  return { running: appProc.exitCode === undefined && !appProc.error, name: appProc.name, pid: appProc.pid || null, startedAt: appProc.startedAt, exitCode: appProc.exitCode !== undefined ? appProc.exitCode : null, error: appProc.error || null, output: appProc.output };
}

// rec-scoped so a late exit from a replaced child can't touch the current app's state
function pushLine(rec, s, line) {
  if (line.length > 300) line = line.slice(0, 300) + "…";
  rec.output.push({ t: Date.now(), s, line });
  if (rec.output.length > 50) rec.output.shift();
  if (rec !== appProc || appBcastTimer) return;
  appBcastTimer = setTimeout(() => { appBcastTimer = null; broadcast(); }, 50);
}

function startApp(entry, userArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [path.join(APPS_DIR, entry.file), "--host", `127.0.0.1:${PORT}`, ...userArgs], {
      env: Object.assign({}, process.env, { PYTHONUNBUFFERED: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const rec = { child, name: entry.name, pid: null, startedAt: Date.now(), exitCode: undefined, error: null, output: [], buf: { out: "", err: "" } };
    appProc = rec;

    let settled = false;
    function settle(err) { if (settled) return; settled = true; if (err) reject(err); else resolve(rec.pid); }

    child.on("spawn", () => { rec.pid = child.pid; settle(null); if (rec === appProc) broadcast(); });
    child.on("error", (err) => {
      rec.error = err.message;
      settle(err);
      if (rec === appProc) broadcast();
    });

    function lineBuffer(stream, s) {
      child[stream].on("data", (chunk) => {
        rec.buf[s] += chunk.toString("utf8");
        let nl;
        while ((nl = rec.buf[s].indexOf("\n")) !== -1) {
          pushLine(rec, s, rec.buf[s].slice(0, nl));
          rec.buf[s] = rec.buf[s].slice(nl + 1);
        }
      });
    }
    lineBuffer("stdout", "out");
    lineBuffer("stderr", "err");

    child.on("exit", (code) => {
      if (rec.buf.out) { pushLine(rec, "out", rec.buf.out); rec.buf.out = ""; }
      if (rec.buf.err) { pushLine(rec, "err", rec.buf.err); rec.buf.err = ""; }
      rec.exitCode = code !== null ? code : -1;
      pushLine(rec, "out", `[process exited: ${rec.exitCode}]`);
      if (rec === appProc) broadcast();
    });
  });
}

function stopApp() {
  return new Promise((resolve) => {
    if (!appProc || !appProc.child || appProc.exitCode !== undefined || appProc.error) { resolve(false); return; }
    const child = appProc.child;
    let done = false;
    child.once("exit", () => { if (!done) { done = true; resolve(true); } });
    try { process.kill(-child.pid, "SIGINT"); } catch (_) { child.kill("SIGINT"); }
    setTimeout(() => { if (!done) { done = true; try { process.kill(-child.pid, "SIGKILL"); } catch (_) { try { child.kill("SIGKILL"); } catch (_2) {} } resolve(true); } }, 1500);
  });
}

/* ------------------------------ device state ----------------------------- */
const BAR_SETTINGS = { theme: "busy", show_work_phase_only: false, trigger_smart_home: true };
const state = {
  frame: { application_name: null, elements: [], ts: 0, priority: 0 },
  brightness: 80,                 // number 0-100 or "auto"
  volume: 0,
  name: "BUSY-EMULATOR",
  battery_charge: 100,
  startTime: Date.now(),
  busy_snapshot: { snapshot: { type: "NOT_STARTED", busy_bar_settings: Object.assign({}, BAR_SETTINGS) }, snapshot_timestamp_ms: Date.now() },
  busy_profiles: {
    busy:   { sort_order: 0, title: "Busy",   id: "profile-busy",   timer_settings: { type: "INFINITE" }, busy_bar_settings: Object.assign({}, BAR_SETTINGS), profile_timestamp_ms: Date.now() },
    custom: { sort_order: 1, title: "Custom", id: "profile-custom", timer_settings: { type: "SIMPLE", total_time_ms: 1200000 }, busy_bar_settings: { theme: "keep_out", show_work_phase_only: false, trigger_smart_home: true }, profile_timestamp_ms: Date.now() },
  },
  assets: {},
  storage: {},
  log: [],
};
let frameSeq = 1;

/* ------------------------------ SSE clients ------------------------------ */
const clients = new Set();
function uptimeStr(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return `${String(d).padStart(2, "0")}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`; }
function snapshot() {
  return {
    frame: state.frame, brightness: state.brightness, volume: state.volume, name: state.name,
    battery_charge: state.battery_charge, uptime: Math.floor((Date.now() - state.startTime) / 1000),
    theme: state.busy_snapshot.snapshot.busy_bar_settings ? state.busy_snapshot.snapshot.busy_bar_settings.theme : null,
    log: state.log.slice(0, 18),
    app: appStatus(),
  };
}
function broadcast() { const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`; for (const r of clients) { try { r.write(data); } catch (_) {} } }
function emit(ev, p) { const data = `event: ${ev}\ndata: ${JSON.stringify(p)}\n\n`; for (const r of clients) { try { r.write(data); } catch (_) {} } }
function logCall(method, p, note) { state.log.unshift({ t: Date.now(), method, path: p, note: note || "" }); if (state.log.length > 30) state.log.length = 30; }

/* ------------------------------- helpers -------------------------------- */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-API-Token, X-API-Sem-Ver", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" };
function send(res, code, obj, headers) {
  const body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
  res.writeHead(code, Object.assign({ "Content-Type": Buffer.isBuffer(obj) ? "application/octet-stream" : "application/json" }, CORS, headers || {}));
  res.end(body);
}
function ok(res, extra) { send(res, 200, Object.assign({ result: "OK" }, extra || {})); }
function fail(res, code, msg) { send(res, code, { error: msg, code }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error("payload too large")); req.destroy(); } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) { const b = await readBody(req); return b.length ? JSON.parse(b.toString("utf8")) : {}; }
function isLocal(req) { const a = req.socket.remoteAddress || ""; return a === "::1" || a.includes("127.0.0.1"); }
function authed(req) { if (!TOKEN) return true; if (isLocal(req)) return true; return req.headers["x-api-token"] === TOKEN; }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json" };
// Decode percent-escapes and resolve inside root (frame files may contain spaces).
function staticPath(root, sub) {
  let rel; try { rel = decodeURIComponent(sub); } catch (_) { return null; }
  const file = path.join(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}
function serveStatic(res, file) {
  if (!file) { fail(res, 404, "not found"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { fail(res, 404, "not found"); return; }
    const ext = path.extname(file);
    // App files must not be cached (dev); heavy immutable assets can be.
    const cache = /\.(ttf|woff2|png|svg)$/.test(ext) ? "max-age=86400" : "no-cache";
    res.writeHead(200, Object.assign({ "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache }, CORS));
    res.end(buf);
  });
}

/* -------------------------------- routes -------------------------------- */
const server = http.createServer(async (req, res) => {
  let p, q;
  try { const u = new URL(req.url, "http://localhost"); p = u.pathname; q = Object.fromEntries(u.searchParams); }
  catch (_) { return fail(res, 400, "bad request"); }
  const method = req.method;
  if (method === "OPTIONS") { send(res, 204, {}); return; }

  // static + stream (no auth)
  if (method === "GET" && (p === "/" || p === "/index.html")) return serveStatic(res, fs.existsSync(path.join(DIST, "index.html")) ? path.join(DIST, "index.html") : path.join(PUBLIC, "index.html"));
  if (method === "GET" && p.startsWith("/static/")) return serveStatic(res, staticPath(DIST, p.replace(/^\//, "")));
  if (method === "GET" && p === "/events") {
    res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }, CORS));
    res.write("retry: 2000\n\n"); res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (method === "GET" && (p.startsWith("/public/") || p.startsWith("/animations/"))) return serveStatic(res, staticPath(PUBLIC, p.replace(/^\/public\//, "").replace(/^\//, "")));
  if (method === "GET" && p === "/api/_animations") return send(res, 200, ANIMATIONS);
  if (method === "GET" && p.startsWith("/assets/")) {
    const a = state.assets[decodeURIComponent(p.slice("/assets/".length))];
    if (!a) return fail(res, 404, "asset not found");
    res.writeHead(200, Object.assign({ "Content-Type": a.type || "application/octet-stream" }, CORS)); return res.end(a.buf);
  }

  // API-version gate (real device: 405 if X-API-Sem-Ver major != 25), version/access/transport exempt
  const sv = req.headers["x-api-sem-ver"];
  if (sv && !/\/api\/(version|access|transport)/.test(p)) {
    const major = String(sv).split(".")[0];
    if (!/^\d+$/.test(major)) return fail(res, 400, "bad X-API-Sem-Ver");
    if (major !== "25") return fail(res, 405, "Incompatible API version");
  }
  // auth gate (always-allow version/access/transport)
  if (p.startsWith("/api/") && !/\/api\/(version|access|transport)/.test(p) && !authed(req)) return fail(res, 403, "Forbidden");

  try {
    /* ---- display ---- */
    if (p === "/api/display/draw" && method === "POST") {
      const b = await readJson(req);
      const appName = b.application_name || b.app_id;   // accept both (community scripts use app_id)
      if (!appName) return fail(res, 400, "Bad request: application_name required");
      const elements = b.elements;
      if (!Array.isArray(elements) || !elements.length) return fail(res, 400, "Nothing to display");
      if (elements.length > 100) return fail(res, 400, "Elements number limit exceeded");
      let priority = b.priority == null ? 50 : b.priority;
      if (typeof priority !== "number" || priority < 1 || priority > 100) return fail(res, 400, "Bad request: priority 1-100");
      const cur = state.frame.elements.length ? state.frame.priority : 0;
      if (state.frame.elements.length && priority < cur) return fail(res, 409, "Not drawn due to low priority");
      state.frame = { application_name: appName, elements, ts: frameSeq++, priority };
      if (b.led_notification_color) emit("led", { color: b.led_notification_color });
      logCall("POST", p, `${appName} · ${elements.length} el · pri ${priority}`); broadcast(); return ok(res);
    }
    if (p === "/api/display/draw" && method === "DELETE") {
      const app = q.application_name;
      if (!app || state.frame.application_name === app || !state.frame.elements.length) {
        state.frame = { application_name: null, elements: [], ts: frameSeq++, priority: 0 };
      }
      logCall("DELETE", p, app || "all"); broadcast(); return ok(res);
    }
    if (p === "/api/display/brightness") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, { value: state.brightness === "auto" ? "auto" : String(state.brightness) }); }
      if (method === "POST") {
        const v = q.value;
        if (v === "auto") state.brightness = "auto";
        else { const n = Number(v); if (!(n >= 0 && n <= 100)) return fail(res, 400, "Bad request: value 0-100 or auto"); state.brightness = n; }
        logCall("POST", p, `value ${v}`); broadcast(); return ok(res);
      }
    }

    /* ---- audio ---- */
    if (p === "/api/audio/play" && method === "POST") { const b = await readJson(req); logCall("POST", p, b.stock_path || b.path || ""); emit("beep", { path: b.path || b.stock_path || "" }); return ok(res); }
    if (p === "/api/audio/play" && method === "DELETE") { logCall("DELETE", p, "stop"); return ok(res); }
    if (p === "/api/audio/volume") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, { volume: state.volume }); }
      if (method === "POST") { const n = Number(q.volume); if (!(n >= 0 && n <= 100)) return fail(res, 400, "Bad request: volume 0-100"); state.volume = n; logCall("POST", p, `vol ${n}`); broadcast(); return ok(res); }
    }

    /* ---- assets (raw octet-stream, ?file=) ---- */
    if (p === "/api/assets/upload" && method === "POST") {
      const app = q.application_name, file = q.file;
      if (!app || !file) return fail(res, 400, "application_name and file required");
      let buf;
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) { const b = await readJson(req); buf = Buffer.from(b.data || "", "base64"); }
      else buf = await readBody(req);
      state.assets[`${app}/${file}`] = { buf, type: "image/png" };
      logCall("POST", p, `${app}/${file} · ${buf.length}b`); return ok(res);
    }
    if (p === "/api/assets/upload" && method === "DELETE") {
      const app = q.application_name; if (!app) return fail(res, 400, "application_name required");
      let n = 0; for (const k of Object.keys(state.assets)) if (k.startsWith(app + "/")) { delete state.assets[k]; n++; }
      if (!n) return fail(res, 404, "Assets not found");
      logCall("DELETE", p, app); return ok(res);
    }

    /* ---- storage (?path=, raw bodies) ---- */
    if (p === "/api/storage/write" && method === "POST") { if (!q.path) return fail(res, 400, "path required"); state.storage[q.path] = { type: "file", data: await readBody(req) }; logCall("POST", p, q.path); return ok(res); }
    if (p === "/api/storage/read" && method === "GET") { const f = state.storage[q.path]; if (!f) return fail(res, 400, "not found"); logCall("GET", p, q.path); return send(res, 200, Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data || ""))); }
    if (p === "/api/storage/list" && method === "GET") { const pre = q.path || ""; const items = Object.keys(state.storage).filter((k) => k.startsWith(pre)).map((k) => ({ type: state.storage[k].type || "file", name: k, size: state.storage[k].data ? state.storage[k].data.length : 0 })); logCall("GET", p, pre); return send(res, 200, { list: items }); }
    if (p === "/api/storage/remove" && method === "DELETE") { delete state.storage[q.path]; logCall("DELETE", p, q.path); return ok(res); }
    if (p === "/api/storage/mkdir" && method === "POST") { state.storage[q.path] = { type: "dir", data: null }; logCall("POST", p, q.path); return ok(res); }
    if (p === "/api/storage/rename" && method === "POST") { if (state.storage[q.path]) { state.storage[q.new_path] = state.storage[q.path]; delete state.storage[q.path]; } logCall("POST", p, `${q.path}→${q.new_path}`); return ok(res); }
    if (p === "/api/storage/status" && method === "GET") { return send(res, 200, { used_bytes: 1048576, free_bytes: 15728640, total_bytes: 16777216 }); }

    /* ---- busy timer ---- */
    if (p === "/api/busy/snapshot") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, state.busy_snapshot); }
      if (method === "PUT") {
        const b = await readJson(req); const snap = b.snapshot || {};
        const type = snap.type; const TYPES = ["NOT_STARTED", "INFINITE", "SIMPLE", "INTERVAL"];
        if (!TYPES.includes(type)) return fail(res, 400, "Bad request: snapshot.type");
        const kept = { type, busy_bar_settings: snap.busy_bar_settings || Object.assign({}, BAR_SETTINGS) };
        for (const k of ["card_id", "is_paused", "time_left_ms", "current_interval", "current_interval_time_total_ms", "current_interval_time_left_ms", "interval_settings"]) if (snap[k] !== undefined) kept[k] = snap[k];
        state.busy_snapshot = { snapshot: kept, snapshot_timestamp_ms: b.snapshot_timestamp_ms || Date.now() };
        logCall("PUT", p, type); broadcast(); return ok(res);
      }
    }
    const mProf = p.match(/^\/api\/busy\/profiles\/(busy|custom)$/);
    if (mProf) {
      const slot = mProf[1];
      if (method === "GET") { logCall("GET", p); return send(res, 200, state.busy_profiles[slot]); }
      if (method === "PUT") { const b = await readJson(req); state.busy_profiles[slot] = Object.assign({}, state.busy_profiles[slot], b, { profile_timestamp_ms: Date.now() }); logCall("PUT", p, slot); return ok(res); }
    }

    /* ---- device ---- */
    if (p === "/api/name") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, { name: state.name }); }
      if (method === "POST") { const b = await readJson(req); if (typeof b.name !== "string") return fail(res, 400, "name required"); state.name = b.name; logCall("POST", p, state.name); broadcast(); return ok(res); }
    }
    if (p === "/api/time" && method === "GET") { logCall("GET", p); return send(res, 200, { timestamp: new Date().toISOString() }); }
    if (p === "/api/time/timestamp" && method === "POST") { logCall("POST", p, q.timestamp); return ok(res); }
    if (p === "/api/time/timezone") { if (method === "GET") return send(res, 200, { name: "Europe/Amsterdam", offset: 3600, abbr: "CET" }); if (method === "POST") { logCall("POST", p, q.timezone); return ok(res); } }
    if (p === "/api/time/tzlist" && method === "GET") { return send(res, 200, { list: [{ name: "Europe/Amsterdam", offset: 3600, abbr: "CET" }, { name: "UTC", offset: 0, abbr: "UTC" }] }); }

    if (p === "/api/status" || p.startsWith("/api/status/")) {
      const up = Math.floor((Date.now() - state.startTime) / 1000);
      const groups = {
        device: { serial_number: "EMU00000000", usb_mac: "02:00:00:00:00:01", otp_valid: true, firmware_security: "none" },
        firmware: { version: "emulator-1.1.0", target: "emu", branch: "dev", build_date: "2026-07-22", commit_hash: "emulator", api_semver: API_SEMVER },
        system: { api_semver: API_SEMVER, uptime: uptimeStr(up), boot_time: Math.floor(state.startTime / 1000), auto_update_enabled: false },
        power: { state: "discharging", battery_charge: state.battery_charge, battery_voltage: 4.01, battery_current: -0.12, usb_voltage: 0 },
      };
      const sub = p.slice("/api/status/".length);
      logCall("GET", p);
      if (p === "/api/status") return send(res, 200, groups);
      if (groups[sub]) return send(res, 200, groups[sub]);
      return fail(res, 404, "no such status group");
    }
    if (p === "/api/version" && method === "GET") { logCall("GET", p); return send(res, 200, { api_semver: API_SEMVER }); }
    if (p === "/api/transport" && method === "GET") { return send(res, 200, { type: isLocal(req) ? "usb" : "wifi" }); }
    if (p === "/api/access") { if (method === "GET") return send(res, 200, { mode: TOKEN ? "key" : "disabled", key_valid: !TOKEN }); if (method === "POST") { logCall("POST", p, q.mode); return ok(res); } }
    if (p === "/api/input" && method === "POST") { const KEYS = ["up", "down", "ok", "back", "start", "busy", "custom", "off", "apps", "settings"]; if (!KEYS.includes(q.key)) return fail(res, 400, "bad key"); logCall("POST", p, q.key); emit("input", { key: q.key }); return ok(res); }
    if (p === "/api/log_dump" && method === "POST") { logCall("POST", p, q.filename || ""); return ok(res, { path: `/ext/logs/${q.filename || "dump"}.txt` }); }

    /* ---- emulator: app runner ---- */
    if (p === "/api/_apps" && method === "GET") { return send(res, 200, { apps: scanApps(), app: appStatus() }); }
    if (p === "/api/_apps/start" && method === "POST") {
      const b = await readJson(req);
      const apps = scanApps();
      const entry = apps.find((a) => a.name === b.name);
      if (!entry) return fail(res, 404, `unknown app: ${b.name}`);
      const userArgs = b.args !== undefined ? b.args : [];
      if (!Array.isArray(userArgs)) return fail(res, 400, "args must be an array");
      if (userArgs.length > 8) return fail(res, 400, "args: max 8 entries");
      for (const a of userArgs) {
        if (typeof a !== "string") return fail(res, 400, "args entries must be strings");
        if (a.length > 64) return fail(res, 400, "args entry too long (max 64)");
        if (a.startsWith("--host")) return fail(res, 400, "args may not contain --host");
      }
      logCall("POST", p, `start ${entry.name}`);
      let pid;
      try {
        pid = await new Promise((resolve, reject) => {
          appOpChain = appOpChain.then(async () => {
            await stopApp();
            try { resolve(await startApp(entry, userArgs)); } catch (e) { reject(e); }
          });
        });
      } catch (e) { logCall("POST", p, `error ${e.message}`); return fail(res, 500, e.message); }
      return ok(res, { pid });
    }
    if (p === "/api/_apps/stop" && method === "POST") {
      logCall("POST", p, "stop");
      const stopped = await new Promise((resolve) => { appOpChain = appOpChain.then(async () => { resolve(await stopApp()); }); });
      return ok(res, { stopped });
    }

    fail(res, 404, `no route for ${method} ${p}`);
  } catch (err) { fail(res, 400, err.message || "bad request"); }
});

function killChild() {
  if (!appProc || !appProc.child) return;
  const pid = appProc.child.pid;
  if (!pid) return;
  // Use spawnSync("kill") so the signal is delivered synchronously before we exit.
  try { spawnSync("kill", ["-9", String(-pid)]); } catch (_) {}
  try { spawnSync("kill", ["-9", String(pid)]); } catch (_) {}
}
process.on("SIGINT", () => { killChild(); process.exit(0); });
process.on("SIGTERM", () => { killChild(); process.exit(0); });

server.listen(PORT, () => {
  console.log(`\n  BUSY Bar emulator running`);
  console.log(`  ├─ display : http://127.0.0.1:${PORT}/`);
  console.log(`  ├─ API base: http://127.0.0.1:${PORT}/api  (api_semver ${API_SEMVER})`);
  console.log(`  └─ ${Object.keys(ANIMATIONS).length} device animation(s)${TOKEN ? " · X-API-Token required for non-localhost" : ""}\n`);
});
