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
const os = require("os");
const path = require("path");
const { createStatusWs, encodeInputKey } = require("./status_ws");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const TOKEN = process.env.BUSY_API_TOKEN || null;
const PUBLIC = path.join(__dirname, "public");
const DIST = path.join(__dirname, "web", "dist");   // built Vue app
const ANIM_DIR = path.join(PUBLIC, "animations");
const SOUNDS_DIR = path.join(PUBLIC, "sounds");
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

/* ---------------------------- sounds manifest ---------------------------- */
function scanSounds() {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(SOUNDS_DIR); } catch (_) { return out; }
  for (const f of files) { if (/\.(wav|mp3|ogg)$/i.test(f)) out[path.basename(f, path.extname(f))] = f; }
  return out;
}
const SOUNDS = scanSounds();

/* ---------------------------- persistence -------------------------------- */
const DATA_DIR = path.join(__dirname, ".data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
let _saveTimer = null;
function saveState() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const stor = {}; for (const [k, v] of Object.entries(state.storage)) stor[k] = { type: v.type, b64: v.data ? v.data.toString("base64") : null };
    const ass = {}; for (const [k, v] of Object.entries(state.assets)) ass[k] = { b64: v.buf.toString("base64"), type: v.type };
    const json = JSON.stringify({ storage: stor, assets: ass, mirror: state.mirror, wifi_api: state.wifi_api, http_token: state.http_token });
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = STATE_FILE + ".tmp"; fs.writeFileSync(tmp, json); fs.renameSync(tmp, STATE_FILE); } catch (e) { console.warn("[persist] save failed:", e.message); }
  }, 500);
}
function loadState(st) {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const { storage, assets, mirror, wifi_api, http_token } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (storage) for (const [k, v] of Object.entries(storage)) st.storage[k] = { type: v.type, data: v.b64 ? Buffer.from(v.b64, "base64") : null };
    if (assets) for (const [k, v] of Object.entries(assets)) st.assets[k] = { buf: Buffer.from(v.b64, "base64"), type: v.type };
    if (mirror && typeof mirror === "object") st.mirror = { enabled: !!mirror.enabled, host: String(mirror.host || ""), token: String(mirror.token || "") };
    if (typeof wifi_api === "boolean") st.wifi_api = wifi_api;
    if (typeof http_token === "string") st.http_token = http_token;
  } catch (e) { console.warn("[persist] could not load state.json, starting empty:", e.message); }
}

/* ------------------------------ device state ----------------------------- */
const BAR_SETTINGS = { theme: "busy", show_work_phase_only: false, trigger_smart_home: true };
const state = {
  frame: { application_name: null, elements: [], ts: 0, priority: 0 },
  appElements: {},                // per-app persistent element sets: firmware upserts by id and never auto-releases (only DELETE clears), capped at 100 — see mergeAppElements
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
  mirror: { enabled: false, host: "", token: "" },   // emulator-only: relay app calls to a real bar
  wifi_api: true,                                     // "HTTP API access over Wi-Fi" toggle (localhost always allowed)
  http_token: "",                                     // UI-set password (X-API-Token) for non-localhost callers; env BUSY_API_TOKEN wins
};
loadState(state);
let frameSeq = 1;

/* --------------------------- scenario simulator -------------------------- */
// Emulator-only fault injection. Ephemeral by design: never persisted.
const scenario = { offline_until: 0, power_state: "discharging" };
let offlineTimer = null, stealTimer = null;
const STEAL_APP = "_scenario.steal";
function scenarioInfo() {
  const owns = state.frame.application_name === STEAL_APP && state.frame.elements.length > 0;
  return {
    power_state: scenario.power_state,
    battery_charge: state.battery_charge,
    offline_until: scenario.offline_until,
    offline_remaining_ms: Math.max(0, scenario.offline_until - Date.now()),
    steal: { active: owns, priority: owns ? state.frame.priority : null },
  };
}
// Priority-conflict rule shared by POST /api/display/draw and the steal scenario.
// Firmware (canvas_draw_rejected): the current owner may redraw at equal
// priority; a different app needs strictly higher priority to take over.
function drawFrame(appName, elements, priority) {
  if (state.frame.elements.length) {
    const sameApp = appName === state.frame.application_name;
    if (sameApp ? priority < state.frame.priority : priority <= state.frame.priority) return false;
  }
  state.frame = { application_name: appName, elements, ts: frameSeq++, priority };
  return true;
}

// Firmware keeps a persistent, id-keyed element set PER application_name: a draw
// UPSERTS its elements into that set (match by id, replace in place) and never
// releases the ones you stop sending — only DELETE /api/display/draw clears them.
// The set is capped at 100 elements; the draw that would push it past 100 returns
// 400 "Elements number limit exceeded". This is why an app that gives every frame
// fresh ids slowly fills the set and then dies on hardware even though each single
// draw is tiny. Returns the merged (accumulated) array, or null if it would exceed
// the cap (in which case the prior set is left untouched, matching the device).
const MAX_ELEMENTS = 100;
function mergeAppElements(appName, incoming) {
  const merged = (state.appElements[appName] || []).slice();
  const indexById = new Map(merged.map((el, i) => [el.id, i]));
  for (const el of incoming) {
    const at = indexById.get(el.id);
    if (at === undefined) { indexById.set(el.id, merged.length); merged.push(el); }
    else merged[at] = el;                 // upsert in place — keep draw order stable
  }
  if (merged.length > MAX_ELEMENTS) return null;
  state.appElements[appName] = merged;
  return merged;
}

// Firmware schema (api_semver 25.0.0) draw contract: every element carries an
// `id`, and every colour is #RRGGBBAA. The real bar 400s on a missing id or an
// old-style 0xRRGGBBAA colour, so the emulator rejects them too — "what fails
// there fails here". Returns an error string, or null when the body is valid.
const DRAW_ID_RE = /^[a-zA-Z0-9._-]+$/;
const DRAW_COLOR_RE = /^#[0-9a-fA-F]{8}$/;
function validateDrawBody(b) {
  if (b.led_notification_color != null && !DRAW_COLOR_RE.test(b.led_notification_color))
    return "led_notification_color must be #RRGGBBAA";
  for (let i = 0; i < b.elements.length; i++) {
    const el = b.elements[i];
    if (!el || typeof el !== "object") return `element ${i}: must be an object`;
    if (typeof el.id !== "string" || !DRAW_ID_RE.test(el.id)) return `element ${i}: 'id' required (^[a-zA-Z0-9._-]+$)`;
    if (el.color != null && !DRAW_COLOR_RE.test(el.color)) return `element '${el.id}': color must be #RRGGBBAA`;
    if (el.border_color != null && !DRAW_COLOR_RE.test(el.border_color)) return `element '${el.id}': border_color must be #RRGGBBAA`;
    if (el.fill_colors != null) {
      if (!Array.isArray(el.fill_colors)) return `element '${el.id}': fill_colors must be an array`;
      for (const c of el.fill_colors) if (!DRAW_COLOR_RE.test(c)) return `element '${el.id}': fill_colors must be #RRGGBBAA`;
    }
  }
  return null;
}

/* ------------------------------ SSE clients ------------------------------ */
const clients = new Set();
function uptimeStr(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return `${String(d).padStart(2, "0")}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`; }
function snapshot() {
  return {
    frame: state.frame, brightness: state.brightness, volume: state.volume, name: state.name,
    battery_charge: state.battery_charge, uptime: Math.floor((Date.now() - state.startTime) / 1000),
    theme: state.busy_snapshot.snapshot.busy_bar_settings ? state.busy_snapshot.snapshot.busy_bar_settings.theme : null,
    log: state.log.slice(0, 18),
    scenario: { offline_until: scenario.offline_until, power_state: scenario.power_state },
    mirror: mirrorInfo(),
  };
}
function broadcast() { const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`; for (const r of clients) { try { r.write(data); } catch (_) {} } }
function emit(ev, p) { const data = `event: ${ev}\ndata: ${JSON.stringify(p)}\n\n`; for (const r of clients) { try { r.write(data); } catch (_) {} } }
function logCall(method, p, note) { state.log.unshift({ t: Date.now(), method, path: p, note: note || "" }); if (state.log.length > 30) state.log.length = 30; }

/* ----------------------- hardware mirror (emulator-only) ----------------- */
// When enabled, relay the app-facing mutating calls (draw, clear, brightness,
// assets, audio) to a real BUSY Bar over HTTP so the browser preview and the
// hardware render the same thing. Best-effort: failures update the status pill
// but never touch the local response — the emulator stays source of truth here.
const MIRROR_TIMEOUT = 2500;
const mirrorStatus = { ok: null, msg: "off", t: Date.now() };
let mirrorBcastTimer = null;
function setMirrorStatus(ok, msg) {
  mirrorStatus.ok = ok; mirrorStatus.msg = msg; mirrorStatus.t = Date.now();
  if (mirrorBcastTimer) return;
  mirrorBcastTimer = setTimeout(() => { mirrorBcastTimer = null; broadcast(); }, 120);
}
function mirrorInfo() {
  return { enabled: state.mirror.enabled, host: state.mirror.host, has_token: !!state.mirror.token,
    status: { ok: mirrorStatus.ok, msg: mirrorStatus.msg, t: mirrorStatus.t } };
}
// "10.0.4.20" | "10.0.4.20:8080" | "http://host/" → { hostname, port }. Bare host → firmware default :80.
function parseHostStr(raw) {
  const s = String(raw || "").replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
  if (!s) return null;
  const i = s.lastIndexOf(":");
  if (i > -1 && /^\d+$/.test(s.slice(i + 1))) { const h = s.slice(0, i); return h ? { hostname: h, port: Number(s.slice(i + 1)) } : null; }
  return { hostname: s, port: 80 };
}
function isSelfTarget(t) {
  return (t.hostname === "127.0.0.1" || t.hostname === "localhost" || t.hostname === "::1" || t.hostname === "0.0.0.0") && t.port === PORT;
}
function cleanQuery(q) { const o = {}; for (const k in q) if (q[k] !== undefined && q[k] !== null) o[k] = q[k]; return o; }
// Normalize a draw body for a real bar: force application_name (firmware requires
// it and ignores the emulator-only app_id alias). Colors already match the
// firmware's #RRGGBBAA form (validateDrawBody enforces it), so no translation.
function toBarDraw(b, appName) {
  const out = Object.assign({}, b, { application_name: appName });
  delete out.app_id;
  return out;
}
// One outbound request. onDone fires exactly once, on completion or failure.
function mirrorRequest(method, apiPath, opts, onDone) {
  const done = onDone || (() => {});
  const t = parseHostStr(state.mirror.host);
  if (!t) { setMirrorStatus(false, "no host set"); return done(); }
  if (isSelfTarget(t)) { setMirrorStatus(false, "host points at the emulator itself"); return done(); }
  const { query, body, ctype } = opts || {};
  const qs = query ? "?" + new URLSearchParams(cleanQuery(query)).toString() : "";
  const headers = {};
  if (body != null) { headers["Content-Type"] = ctype || "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
  if (state.mirror.token) headers["X-API-Token"] = state.mirror.token;
  let settled = false;
  const finish = (ok, msg) => { if (settled) return; settled = true; setMirrorStatus(ok, msg); done(); };
  const rq = http.request({ hostname: t.hostname, port: t.port, path: apiPath + qs, method, headers, timeout: MIRROR_TIMEOUT }, (resp) => {
    resp.resume();
    resp.on("end", () => finish(resp.statusCode < 400, `${method} ${apiPath} → ${resp.statusCode}`));
    resp.on("error", () => finish(false, "response error"));
  });
  rq.on("error", (e) => finish(false, e.code || e.message || "request error"));
  rq.on("timeout", () => rq.destroy(new Error("timeout")));
  if (body != null) rq.write(body);
  rq.end();
}
// Display channel (draw + clear): coalesce to at most one in-flight + one latest
// pending, so a fast redraw loop against a slow/dead bar can't back up sockets.
const displayFlight = { busy: false, next: null };
function mirrorDisplay(method, apiPath, opts) {
  if (!state.mirror.enabled) return;
  if (displayFlight.busy) { displayFlight.next = { method, apiPath, opts }; return; }
  displayFlight.busy = true;
  mirrorRequest(method, apiPath, opts, () => {
    displayFlight.busy = false;
    const n = displayFlight.next; displayFlight.next = null;
    if (n && state.mirror.enabled) mirrorDisplay(n.method, n.apiPath, n.opts);
  });
}
// Low-frequency channel (brightness, assets, audio): plain fire-and-forget.
function mirrorCall(method, apiPath, opts) {
  if (!state.mirror.enabled) return;
  mirrorRequest(method, apiPath, opts, null);
}
// Reachability probe for POST /api/_mirror/test — a dry run that never persists.
function mirrorHttpGet(t, apiPath, token) {
  return new Promise((resolve) => {
    const headers = {}; if (token) headers["X-API-Token"] = token;
    const rq = http.request({ hostname: t.hostname, port: t.port, path: apiPath, method: "GET", headers, timeout: MIRROR_TIMEOUT }, (resp) => {
      const chunks = []; resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => { let j = {}; try { j = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (_) {} resolve({ status: resp.statusCode, json: j }); });
      resp.on("error", () => resolve({ error: "response error" }));
    });
    rq.on("error", (e) => resolve({ error: e.code || e.message || "request error" }));
    rq.on("timeout", () => { rq.destroy(); resolve({ error: "timeout" }); });
    rq.end();
  });
}
async function mirrorProbe(host, token) {
  const t = parseHostStr(host);
  if (!t) return { ok: false, error: "invalid host" };
  if (isSelfTarget(t)) return { ok: false, error: "that is the emulator itself" };
  const [ver, nm] = await Promise.all([
    mirrorHttpGet(t, "/api/version", token),
    mirrorHttpGet(t, "/api/name", token),
  ]);
  if (ver.error) return { ok: false, error: ver.error };
  if (ver.status >= 400) return { ok: false, error: `HTTP ${ver.status}`, http_status: ver.status };
  return { ok: true, http_status: ver.status, api_semver: (ver.json && ver.json.api_semver) || null, name: (nm.json && nm.json.name) || null };
}
// Non-internal IPv4 addresses the emulator's HTTP API is reachable on (it binds
// all interfaces), i.e. the "over Wi-Fi/LAN" URLs shown in the Network tab.
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const ni of ifs[name] || []) {
    if (ni && ni.family === "IPv4" && !ni.internal) out.push(ni.address);
  }
  return out;
}
// Payload for the Network tab's HTTP API card. token_required reflects the
// effective password; password_env means it is fixed by BUSY_API_TOKEN (UI can't change it).
function netinfoBody() {
  return { port: PORT, addresses: lanAddresses(), token_required: !!effectiveToken(), password_env: !!TOKEN, wifi_api: state.wifi_api, api_semver: API_SEMVER };
}
// /docs serves Swagger UI (like the real bar), backed by the emulator's own
// OpenAPI spec at /openapi.json. The Swagger UI assets are the only runtime
// external dependency, and only for this docs page.
function swaggerPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BUSY Bar Emulator · API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
<style>body{margin:0}.swagger-ui .topbar{display:none}</style></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>window.onload=function(){window.ui=SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,tryItOutEnabled:true,defaultModelsExpandDepth:0})};</script>
</body></html>`;
}
// OpenAPI 3 spec for the emulator's own API (firmware-faithful routes + the
// emulator-only /api/_* conveniences). Served at /openapi.json for Swagger UI.
function openapiSpec() {
  const servers = [{ url: `http://127.0.0.1:${PORT}`, description: "USB (localhost)" }]
    .concat(lanAddresses().map((a) => ({ url: `http://${a}:${PORT}`, description: "Wi-Fi / LAN" })));
  const color = { type: "string", pattern: "^#[0-9A-Fa-f]{8}$", example: "#2B7FFFFF", description: "#RRGGBBAA" };
  const withBase = (props, required) => ({ allOf: [{ $ref: "#/components/schemas/ElementBase" }, { type: "object", required: required || [], properties: props }] });
  const jsonBody = (ref) => ({ required: true, content: { "application/json": { schema: { $ref: ref } } } });
  const bin = { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } };
  const objBody = (props) => ({ content: { "application/json": { schema: { type: "object", properties: props } } } });
  const R = (desc, ref) => ({ description: desc, content: { "application/json": { schema: { $ref: ref } } } });
  const okR = R("OK", "#/components/schemas/Success");
  const errR = R("Error", "#/components/schemas/Error");
  const dataR = (desc, props) => ({ description: desc, content: { "application/json": { schema: { type: "object", properties: props } } } });
  const qp = (name, description, opts) => Object.assign({ name, in: "query", description, schema: { type: "string" } }, opts || {});

  const paths = {
    "/api/display/draw": {
      post: { tags: ["Display"], summary: "Draw a frame", requestBody: jsonBody("#/components/schemas/DisplayElements"),
        responses: { "200": okR, "400": errR, "409": R("Priority too low", "#/components/schemas/Error") } },
      delete: { tags: ["Display"], summary: "Clear the display", parameters: [qp("application_name", "omit to clear all")], responses: { "200": okR } },
    },
    "/api/display/brightness": {
      get: { tags: ["Display"], summary: "Get brightness", responses: { "200": dataR("brightness", { value: { type: "string", example: "80", description: "\"auto\" or \"0\"-\"100\"" } }) } },
      post: { tags: ["Display"], summary: "Set brightness", parameters: [qp("value", "auto or 0-100", { required: true })], responses: { "200": okR, "400": errR } },
    },
    "/api/audio/play": {
      post: { tags: ["Audio"], summary: "Play a sound", requestBody: jsonBody("#/components/schemas/PlayAudio"), responses: { "200": okR, "400": errR } },
      delete: { tags: ["Audio"], summary: "Stop playback", responses: { "200": okR } },
    },
    "/api/audio/volume": {
      get: { tags: ["Audio"], summary: "Get volume", responses: { "200": dataR("volume", { volume: { type: "integer", example: 60 } }) } },
      post: { tags: ["Audio"], summary: "Set volume", parameters: [qp("volume", "0-100", { required: true }), qp("silent", "")], responses: { "200": okR, "400": errR } },
    },
    "/api/assets/upload": {
      post: { tags: ["Assets"], summary: "Upload asset bytes", parameters: [qp("application_name", "", { required: true }), qp("file", "filename, e.g. logo.png", { required: true })], requestBody: bin, responses: { "200": okR, "400": errR } },
      delete: { tags: ["Assets"], summary: "Delete an app's assets", parameters: [qp("application_name", "", { required: true })], responses: { "200": okR, "404": errR } },
    },
    "/api/storage/write": { post: { tags: ["Storage"], summary: "Write a file", parameters: [qp("path", "", { required: true })], requestBody: bin, responses: { "200": okR } } },
    "/api/storage/read": { get: { tags: ["Storage"], summary: "Read a file", parameters: [qp("path", "", { required: true })], responses: { "200": { description: "file bytes" }, "400": errR } } },
    "/api/storage/list": { get: { tags: ["Storage"], summary: "List files", parameters: [qp("path", "prefix")], responses: { "200": okR } } },
    "/api/storage/remove": { delete: { tags: ["Storage"], summary: "Remove a file", parameters: [qp("path", "", { required: true })], responses: { "200": okR } } },
    "/api/busy/snapshot": {
      get: { tags: ["BUSY timer"], summary: "Get snapshot", responses: { "200": okR } },
      put: { tags: ["BUSY timer"], summary: "Set snapshot", requestBody: objBody({ snapshot: { type: "object" }, snapshot_timestamp_ms: { type: "integer" } }), responses: { "200": okR, "400": errR } },
    },
    "/api/name": {
      get: { tags: ["Device"], summary: "Get device name", responses: { "200": dataR("name", { name: { type: "string", example: "BUSY-EMULATOR" } }) } },
      post: { tags: ["Device"], summary: "Set device name", requestBody: objBody({ name: { type: "string" } }), responses: { "200": okR, "400": errR } },
    },
    "/api/time": { get: { tags: ["Device"], summary: "Get time", responses: { "200": dataR("time", { timestamp: { type: "string", format: "date-time" } }) } } },
    "/api/status": { get: { tags: ["Device"], summary: "Device status", responses: { "200": dataR("nested status groups", { device: { type: "object" }, firmware: { type: "object" }, system: { type: "object" }, power: { type: "object" } }) } } },
    "/api/input": { post: { tags: ["Device"], summary: "Press a button", parameters: [qp("key", "up|down|ok|back|start|busy|custom|off|apps|settings", { required: true })], responses: { "200": okR, "400": errR } } },
    "/api/version": { get: { tags: ["Meta"], summary: "API version", responses: { "200": dataR("version", { api_semver: { type: "string", example: API_SEMVER } }) } } },
    "/api/transport": { get: { tags: ["Meta"], summary: "Transport (usb|wifi)", responses: { "200": dataR("transport", { type: { type: "string", enum: ["usb", "wifi"] } }) } } },
    "/api/access": { get: { tags: ["Meta"], summary: "Auth mode", responses: { "200": dataR("access", { mode: { type: "string", enum: ["disabled", "key"] }, key_valid: { type: "boolean" } }) } } },
    "/api/_scenario": { get: { tags: ["Emulator"], summary: "Scenario state", responses: { "200": okR } } },
    "/api/_scenario/power": { post: { tags: ["Emulator"], summary: "Set battery / charge state", requestBody: objBody({ battery_charge: { type: "integer" }, state: { type: "string", enum: ["charging", "discharging", "charged"] } }), responses: { "200": okR, "400": errR } } },
    "/api/_scenario/offline": { post: { tags: ["Emulator"], summary: "Drop the connection for a window", requestBody: objBody({ duration_ms: { type: "integer" } }), responses: { "200": okR } } },
    "/api/_scenario/steal": { post: { tags: ["Emulator"], summary: "Draw a high-priority frame", requestBody: objBody({ priority: { type: "integer" }, duration_ms: { type: "integer" } }), responses: { "200": okR, "409": errR } } },
    "/api/_scenario/reset": { post: { tags: ["Emulator"], summary: "Clear scenario overrides", responses: { "200": okR } } },
    "/api/_mirror": {
      get: { tags: ["Emulator"], summary: "Mirror config", responses: { "200": okR } },
      post: { tags: ["Emulator"], summary: "Set mirror config", requestBody: objBody({ enabled: { type: "boolean" }, host: { type: "string" }, token: { type: "string" } }), responses: { "200": okR, "400": errR } },
    },
    "/api/_mirror/test": { post: { tags: ["Emulator"], summary: "Probe a real bar", requestBody: objBody({ host: { type: "string" }, token: { type: "string" } }), responses: { "200": okR, "400": errR } } },
    "/api/_netinfo": {
      get: { tags: ["Emulator"], summary: "USB/Wi-Fi URLs + API state", responses: { "200": okR } },
      post: { tags: ["Emulator"], summary: "Toggle Wi-Fi API access / set password (localhost only)", requestBody: objBody({ wifi_api: { type: "boolean" }, password: { type: "string", description: "X-API-Token for non-localhost callers; \"\" clears" } }), responses: { "200": okR, "400": errR, "403": errR, "409": errR } },
    },
    "/api/_animations": { get: { tags: ["Emulator"], summary: "Animation manifest", responses: { "200": okR } } },
    "/api/_sounds": { get: { tags: ["Emulator"], summary: "Stock-sound manifest", responses: { "200": okR } } },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "BUSY Bar Emulator", version: API_SEMVER,
      description: "Local emulator of the Flipper BUSY Bar HTTP API. Routes, verbs, response shapes and error codes match the real firmware, so an app written here runs unchanged on hardware by swapping the host. Success is `{\"result\":\"OK\"}`; errors are `{\"error\",\"code\"}`. `X-API-Token` is only enforced for non-localhost callers when `BUSY_API_TOKEN` is set; localhost is always allowed.",
    },
    servers,
    tags: [{ name: "Display" }, { name: "Audio" }, { name: "Assets" }, { name: "Storage" }, { name: "BUSY timer" }, { name: "Device" }, { name: "Meta" }, { name: "Emulator", description: "Emulator-only conveniences (underscore prefix)" }],
    paths,
    components: {
      schemas: {
        Success: { type: "object", properties: { result: { type: "string", example: "OK" } } },
        Error: { type: "object", properties: { error: { type: "string" }, code: { type: "integer" } } },
        ElementBase: {
          type: "object", required: ["id", "type"],
          properties: {
            id: { type: "string", example: "a" },
            type: { type: "string", enum: ["text", "image", "animation", "countdown", "rectangle"] },
            x: { type: "integer", default: 0 }, y: { type: "integer", default: 0 },
            align: { type: "string", enum: ["top_left", "top_mid", "top_right", "mid_left", "center", "mid_right", "bottom_left", "bottom_mid", "bottom_right"] },
            display: { type: "string", enum: ["front", "back"], default: "front" },
            timeout: { type: "integer", description: "seconds; mutually exclusive with display_until" },
            display_until: { type: "integer", description: "unix seconds" },
          },
        },
        TextElement: withBase({
          text: { type: "string", example: "HELLO" },
          font: { type: "string", enum: ["tiny", "small", "normal", "condensed", "bold", "large", "extra_large", "global"], default: "normal" },
          color, width: { type: "integer" },
          scroll_rate: { type: "integer", description: "pixel columns per minute (0 = off)" },
          scroll_start_delay: { type: "integer" }, scroll_repeat_delay: { type: "integer" },
        }, ["text"]),
        ImageElement: withBase({
          path: { type: "string", description: "uploaded asset path (bare logo.png resolves in the app's namespace)" },
          stock_path: { type: "string", description: "builtin, e.g. faces/emoji-grinning or sun|cloud|heart|check|bolt" },
          opacity: { type: "integer", minimum: 0, maximum: 100, default: 100 }, color,
        }),
        AnimationElement: withBase({
          stock_path: { type: "string", description: "device animation folder, e.g. coding_72x16 (canonical)" },
          name: { type: "string", description: "legacy alias for stock_path" },
          section: { type: "string" }, loop: { type: "boolean" },
          opacity: { type: "integer", minimum: 0, maximum: 100, default: 100 },
        }),
        CountdownElement: withBase({
          timestamp: { type: "string", pattern: "^[0-9]+$", description: "unix seconds (a number in a string)" },
          direction: { type: "string", enum: ["time_left", "time_since"] },
          show_hours: { type: "string", enum: ["when_non_zero", "always"] }, color,
        }, ["timestamp", "direction"]),
        RectangleElement: withBase({
          width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, radius: { type: "integer", minimum: 0 },
          fill: { type: "string", enum: ["none", "solid", "gradient_h", "gradient_v"], default: "none" },
          fill_colors: { type: "array", items: color, minItems: 1, maxItems: 2 },
          border_width: { type: "integer", default: 1 }, border_color: color,
        }, ["width", "height"]),
        DisplayElements: {
          type: "object", required: ["elements"],
          description: "Requires one of application_name or app_id.",
          properties: {
            application_name: { type: "string", pattern: "^[a-zA-Z0-9._-]+$", example: "cli" },
            app_id: { type: "string", description: "accepted alias for application_name (community scripts); one of the two is required" },
            priority: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            led_notification_color: color,
            elements: {
              type: "array", minItems: 1, items: { oneOf: [
                { $ref: "#/components/schemas/TextElement" }, { $ref: "#/components/schemas/ImageElement" },
                { $ref: "#/components/schemas/AnimationElement" }, { $ref: "#/components/schemas/CountdownElement" },
                { $ref: "#/components/schemas/RectangleElement" },
              ] },
            },
          },
        },
        PlayAudio: { type: "object", required: ["application_name"], properties: { application_name: { type: "string" }, path: { type: "string" }, stock_path: { type: "string" } } },
      },
    },
  };
}

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
// Env BUSY_API_TOKEN wins (immutable); otherwise the UI-set password applies.
function effectiveToken() { return TOKEN || state.http_token || ""; }
// Password from an HTTP Basic header (any username; password half is the token),
// so a browser opening the web UI over Wi-Fi can authenticate via the native prompt.
function basicPassword(req) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers["authorization"] || "");
  if (!m) return null;
  try { const dec = Buffer.from(m[1], "base64").toString("utf8"); const i = dec.indexOf(":"); return i >= 0 ? dec.slice(i + 1) : dec; } catch (_) { return null; }
}
function authed(req) { const tok = effectiveToken(); if (!tok) return true; if (isLocal(req)) return true; return req.headers["x-api-token"] === tok || basicPassword(req) === tok; }

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

/* ----------------- app-facing status stream (device→app) ----------------- */
// Input events reach a running app only on the /api/status/ws WebSocket (busylib
// stream_status_ws), so the Device-buttons UI drives real apps through here.
// Auth mirrors the HTTP gate: no token → open; localhost always allowed;
// otherwise the token must match (busylib passes it as ?x-api-token=).
function wsAuthorize(req) {
  const tok = effectiveToken();
  if (!tok) return true;
  const a = req.socket.remoteAddress || "";
  if (a === "::1" || a.includes("127.0.0.1")) return true;
  let qtok = null;
  try { qtok = new URL(req.url, "http://localhost").searchParams.get("x-api-token"); } catch (_) {}
  return req.headers["x-api-token"] === tok || qtok === tok;
}
const statusWs = createStatusWs({ authorize: wsAuthorize });

/* -------------------------------- routes -------------------------------- */
const server = http.createServer(async (req, res) => {
  let p, q;
  try { const u = new URL(req.url, "http://localhost"); p = u.pathname; q = Object.fromEntries(u.searchParams); }
  catch (_) { return fail(res, 400, "bad request"); }
  const method = req.method;
  // scenario: simulated USB/Wi-Fi drop — non-emulator API traffic (incl. preflights) gets a dead socket (ECONNRESET)
  if (scenario.offline_until > Date.now() && p.startsWith("/api/") && !p.startsWith("/api/_")) { req.socket.destroy(); return; }
  if (method === "OPTIONS") { send(res, 204, {}); return; }

  // Web-interface password over Wi-Fi: the device asks for a password to open the
  // web UI when connected via Wi-Fi. Non-localhost requests for the web interface
  // (everything but /api/*, which has its own X-API-Token gate) get a Basic-auth
  // challenge when a password is set; localhost/USB is always allowed, no prompt.
  if (!p.startsWith("/api/") && effectiveToken() && !isLocal(req) && !authed(req)) {
    res.writeHead(401, Object.assign({ "WWW-Authenticate": 'Basic realm="BUSY Bar Emulator"', "Content-Type": "text/plain; charset=utf-8" }, CORS));
    return res.end("Password required to access the web interface over Wi-Fi.");
  }

  // API docs — Swagger UI at /docs (mirrors the real bar), spec at /openapi.json. No auth.
  if (method === "GET" && (p === "/docs" || p === "/docs/")) { res.writeHead(200, Object.assign({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }, CORS)); return res.end(swaggerPage()); }
  if (method === "GET" && p === "/openapi.json") return send(res, 200, openapiSpec());
  // static + stream (no auth); UI tab paths (emulator-only) fall back to the SPA
  if (method === "GET" && (p === "/" || p === "/index.html" || /^\/(network|firmware|settings|draw-tool|apps|scenarios)$/.test(p))) return serveStatic(res, fs.existsSync(path.join(DIST, "index.html")) ? path.join(DIST, "index.html") : path.join(PUBLIC, "index.html"));
  if (method === "GET" && p.startsWith("/static/")) return serveStatic(res, staticPath(DIST, p.replace(/^\//, "")));
  if ((method === "GET" || method === "HEAD") && p === "/favicon.png") return serveStatic(res, path.join(DIST, "favicon.png"));
  if (method === "GET" && p === "/events") {
    res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }, CORS));
    res.write("retry: 2000\n\n"); res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (method === "GET" && (p.startsWith("/public/") || p.startsWith("/animations/"))) return serveStatic(res, staticPath(PUBLIC, p.replace(/^\/public\//, "").replace(/^\//, "")));
  if (method === "GET" && p === "/api/_animations") return send(res, 200, ANIMATIONS);
  if (method === "GET" && p === "/api/_sounds") return send(res, 200, SOUNDS);
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
  // Emulated "HTTP API access over Wi-Fi" switch: when off, block the device API
  // for non-localhost callers (localhost/USB and emulator-only routes stay reachable).
  if (!state.wifi_api && p.startsWith("/api/") && !/\/api\/(version|access|transport)/.test(p) && !p.startsWith("/api/_") && !isLocal(req)) return fail(res, 403, "HTTP API disabled over Wi-Fi");
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
      let priority = b.priority == null ? 50 : b.priority;
      if (typeof priority !== "number" || priority < 1 || priority > 100) return fail(res, 400, "Bad request: priority 1-100");
      const drawErr = validateDrawBody(b);
      if (drawErr) return fail(res, 400, "Bad request: " + drawErr);
      // Build the mirrored copy from the app's original payload (bare asset paths,
      // pre-rewrite) so the bar does its own namespacing; toBarDraw forces
      // application_name since firmware ignores the emulator-only app_id alias.
      const fwdBody = state.mirror.enabled ? JSON.stringify(toBarDraw(b, appName)) : null;
      // Firmware resolves image paths inside the drawing app's asset namespace
      // (busylib docs: upload filename="logo.png", then draw path="logo.png").
      // Rewrite bare paths to the namespaced asset key; full keys keep working.
      for (const el of elements) {
        if (el && el.type === "image" && el.path && state.assets[`${appName}/${el.path}`]) el.path = `${appName}/${el.path}`;
      }
      // Upsert into the app's persistent, id-keyed set (firmware never auto-releases
      // elements you stop sending) and enforce the 100-element cap against that
      // ACCUMULATED set, not just this payload — an app that hands every frame fresh
      // ids fills the set and then 400s, exactly as it does on hardware. This gate is
      // before the priority check, matching the device (>100 → 400 even for a non-owner).
      const merged = mergeAppElements(appName, elements);
      if (!merged) return fail(res, 400, "Elements number limit exceeded");
      if (!drawFrame(appName, merged, priority)) return fail(res, 409, "Not drawn due to low priority");
      mirrorDisplay("POST", "/api/display/draw", { body: fwdBody });
      if (b.led_notification_color) emit("led", { color: b.led_notification_color });
      logCall("POST", p, `${appName} · ${elements.length} el (${merged.length} stored) · pri ${priority}`); broadcast(); return ok(res);
    }
    if (p === "/api/display/draw" && method === "DELETE") {
      const app = q.application_name;
      if (app) delete state.appElements[app];   // release this app's accumulated set
      else state.appElements = {};              // no app → clear every app's set
      if (!app || state.frame.application_name === app || !state.frame.elements.length) {
        state.frame = { application_name: null, elements: [], ts: frameSeq++, priority: 0 };
      }
      mirrorDisplay("DELETE", "/api/display/draw", { query: app ? { application_name: app } : null });
      logCall("DELETE", p, app || "all"); broadcast(); return ok(res);
    }
    if (p === "/api/display/brightness") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, { value: state.brightness === "auto" ? "auto" : String(state.brightness) }); }
      if (method === "POST") {
        const v = q.value;
        if (v === "auto") state.brightness = "auto";
        else { const n = Number(v); if (!(n >= 0 && n <= 100)) return fail(res, 400, "Bad request: value 0-100 or auto"); state.brightness = n; }
        mirrorCall("POST", "/api/display/brightness", { query: { value: v } });
        logCall("POST", p, `value ${v}`); broadcast(); return ok(res);
      }
    }

    /* ---- audio ---- */
    if (p === "/api/audio/play" && method === "POST") {
      const b = await readJson(req);
      if (!b.application_name) return fail(res, 400, "Missing application_name");
      if (b.path && b.stock_path) return fail(res, 400, "Both path and stock_path are defined");
      if (!b.path && !b.stock_path) return fail(res, 400, "Missing path or stock_path");
      mirrorCall("POST", "/api/audio/play", { body: JSON.stringify(b) });
      logCall("POST", p, b.stock_path || b.path || "");
      let url = null;
      // firmware resolves the basename after the last "/" incl. extension; also accept the bare name (emulator-only)
      if (b.stock_path) { const base = path.basename(b.stock_path); for (const k of [b.stock_path, base, base.replace(/\.(wav|mp3|ogg)$/i, "")]) if (SOUNDS[k]) { url = "/public/sounds/" + SOUNDS[k]; break; } }
      if (!url && b.path) {
        const nk = `${b.application_name}/${b.path}`;  // firmware resolves bare paths inside the app's asset namespace
        if (state.assets[nk]) url = "/assets/" + nk;
        else if (state.assets[b.path]) url = "/assets/" + b.path;
        else if (state.storage[b.path]) url = "/api/storage/read?path=" + encodeURIComponent(b.path);
      }
      // firmware 404s an unplayable file; no stock sounds are bundled, so unresolved paths 200 + beep fallback (emulator-only)
      emit("beep", { url, path: b.path || null, stock_path: b.stock_path || null }); return ok(res);
    }
    if (p === "/api/audio/play" && method === "DELETE") { mirrorCall("DELETE", "/api/audio/play", {}); logCall("DELETE", p, "stop"); emit("beep", { stop: true }); return ok(res); }
    if (p === "/api/audio/volume") {
      if (method === "GET") { logCall("GET", p); return send(res, 200, { volume: state.volume }); }
      if (method === "POST") { const n = Number(q.volume); if (!(n >= 0 && n <= 100)) return fail(res, 400, "Bad request: volume 0-100"); state.volume = n; mirrorCall("POST", "/api/audio/volume", { query: { volume: q.volume, silent: q.silent } }); logCall("POST", p, `vol ${n}`); broadcast(); return ok(res); }
    }

    /* ---- assets (raw octet-stream, ?file=) ---- */
    if (p === "/api/assets/upload" && method === "POST") {
      const app = q.application_name, file = q.file;
      if (!app || !file) return fail(res, 400, "application_name and file required");
      let buf;
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) { const b = await readJson(req); buf = Buffer.from(b.data || "", "base64"); }
      else buf = await readBody(req);
      const ext = (file.match(/\.([a-z0-9]+)$/i) || [])[1];
      const type = { png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg",
        wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" }[(ext || "").toLowerCase()] || "application/octet-stream";
      state.assets[`${app}/${file}`] = { buf, type };
      mirrorCall("POST", "/api/assets/upload", { query: { application_name: app, file }, body: buf, ctype: "application/octet-stream" });
      saveState(); logCall("POST", p, `${app}/${file} · ${buf.length}b`); return ok(res);
    }
    if (p === "/api/assets/upload" && method === "DELETE") {
      const app = q.application_name; if (!app) return fail(res, 400, "application_name required");
      let n = 0; for (const k of Object.keys(state.assets)) if (k.startsWith(app + "/")) { delete state.assets[k]; n++; }
      if (!n) return fail(res, 404, "Assets not found");
      mirrorCall("DELETE", "/api/assets/upload", { query: { application_name: app } });
      saveState(); logCall("DELETE", p, app); return ok(res);
    }

    /* ---- storage (?path=, raw bodies) ---- */
    if (p === "/api/storage/write" && method === "POST") { if (!q.path) return fail(res, 400, "path required"); state.storage[q.path] = { type: "file", data: await readBody(req) }; saveState(); logCall("POST", p, q.path); return ok(res); }
    if (p === "/api/storage/read" && method === "GET") { const f = state.storage[q.path]; if (!f) return fail(res, 400, "not found"); logCall("GET", p, q.path); return send(res, 200, Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data || ""))); }
    if (p === "/api/storage/list" && method === "GET") { const pre = q.path || ""; const items = Object.keys(state.storage).filter((k) => k.startsWith(pre)).map((k) => ({ type: state.storage[k].type || "file", name: k, size: state.storage[k].data ? state.storage[k].data.length : 0 })); logCall("GET", p, pre); return send(res, 200, { list: items }); }
    if (p === "/api/storage/remove" && method === "DELETE") { delete state.storage[q.path]; saveState(); logCall("DELETE", p, q.path); return ok(res); }
    if (p === "/api/storage/mkdir" && method === "POST") { state.storage[q.path] = { type: "dir", data: null }; saveState(); logCall("POST", p, q.path); return ok(res); }
    if (p === "/api/storage/rename" && method === "POST") { if (state.storage[q.path]) { state.storage[q.new_path] = state.storage[q.path]; delete state.storage[q.path]; } saveState(); logCall("POST", p, `${q.path}→${q.new_path}`); return ok(res); }
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
        power: { state: scenario.power_state, battery_charge: state.battery_charge,
          battery_voltage: +(3.5 + state.battery_charge * 0.007).toFixed(2),
          battery_current: scenario.power_state === "charging" ? 0.35 : scenario.power_state === "charged" ? 0 : -0.12,
          usb_voltage: scenario.power_state === "discharging" ? 0 : 5 },
      };
      const sub = p.slice("/api/status/".length);
      logCall("GET", p);
      if (p === "/api/status") return send(res, 200, groups);
      if (groups[sub]) return send(res, 200, groups[sub]);
      return fail(res, 404, "no such status group");
    }
    if (p === "/api/version" && method === "GET") { logCall("GET", p); return send(res, 200, { api_semver: API_SEMVER }); }
    if (p === "/api/transport" && method === "GET") { return send(res, 200, { type: isLocal(req) ? "usb" : "wifi" }); }
    if (p === "/api/access") { if (method === "GET") { const tok = effectiveToken(); return send(res, 200, { mode: tok ? "key" : "disabled", key_valid: !tok }); } if (method === "POST") { logCall("POST", p, q.mode); return ok(res); } }
    if (p === "/api/input" && method === "POST") {
      const KEYS = ["up", "down", "ok", "back", "start", "busy", "custom", "off", "apps", "settings"];
      if (!KEYS.includes(q.key)) return fail(res, 400, "bad key");
      logCall("POST", p, q.key);
      emit("input", { key: q.key });                          // web UI feedback (SSE)
      const frames = encodeInputKey(q.key);                   // deliver to a running app (WS protobuf)
      if (frames) for (const f of frames) statusWs.broadcast(f);
      return ok(res);
    }
    if (p === "/api/log_dump" && method === "POST") { logCall("POST", p, q.filename || ""); return ok(res, { path: `/ext/logs/${q.filename || "dump"}.txt` }); }

    /* ---- emulator: scenario simulator ---- */
    if (p === "/api/_scenario" && method === "GET") { return send(res, 200, scenarioInfo()); }
    if (p === "/api/_scenario/power" && method === "POST") {
      const b = await readJson(req);
      if (b.battery_charge === undefined && b.state === undefined) return fail(res, 400, "Bad request: battery_charge or state required");
      if (b.battery_charge !== undefined) {
        const n = Number(b.battery_charge);
        if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, 400, "Bad request: battery_charge 0-100");
        state.battery_charge = Math.round(n);
      }
      if (b.state !== undefined) {
        if (!["charging", "discharging", "charged"].includes(b.state)) return fail(res, 400, "Bad request: state charging|discharging|charged");
        scenario.power_state = b.state;
      }
      logCall("POST", p, `${scenario.power_state} · ${state.battery_charge}%`); broadcast(); return ok(res);
    }
    if (p === "/api/_scenario/offline" && method === "POST") {
      if (scenario.offline_until > Date.now()) {
        clearTimeout(offlineTimer); offlineTimer = null; scenario.offline_until = 0;
        logCall("POST", p, "restored"); broadcast(); return ok(res, { offline_until: 0 });
      }
      const b = await readJson(req);
      const n = Number(b.duration_ms);
      if (!Number.isFinite(n) || n < 100 || n > 600000) return fail(res, 400, "Bad request: duration_ms 100-600000");
      scenario.offline_until = Date.now() + n;
      offlineTimer = setTimeout(() => { offlineTimer = null; scenario.offline_until = 0; broadcast(); }, n);
      logCall("POST", p, `offline ${n}ms`); broadcast(); return ok(res, { offline_until: scenario.offline_until });
    }
    if (p === "/api/_scenario/steal" && method === "POST") {
      const b = await readJson(req);
      let priority = b.priority == null ? 99 : b.priority;
      if (typeof priority !== "number" || priority < 1 || priority > 100) return fail(res, 400, "Bad request: priority 1-100");
      let duration = null;
      if (b.duration_ms != null) {
        const n = Number(b.duration_ms);
        if (!Number.isFinite(n) || n < 100 || n > 600000) return fail(res, 400, "Bad request: duration_ms 100-600000");
        duration = n;
      }
      const elements = [
        { id: "s1", type: "rectangle", x: 0, y: 0, width: 72, height: 16, border_width: 1, border_color: "#FF3C3CFF", fill: "none", display: "front" },
        { id: "s2", type: "text", text: `PRIORITY ${priority}`, x: 36, y: 8, font: "small", color: "#FF3C3CFF", align: "center", display: "front" },
      ];
      if (!drawFrame(STEAL_APP, elements, priority)) return fail(res, 409, "Not drawn due to low priority");
      clearTimeout(stealTimer); stealTimer = null;
      if (duration != null) {
        stealTimer = setTimeout(() => { stealTimer = null; if (state.frame.application_name === STEAL_APP) { state.frame = { application_name: null, elements: [], ts: frameSeq++, priority: 0 }; broadcast(); } }, duration);
      }
      logCall("POST", p, `pri ${priority}${duration ? ` · ${duration}ms` : ""}`); broadcast(); return ok(res, { priority });
    }
    if (p === "/api/_scenario/reset" && method === "POST") {
      clearTimeout(offlineTimer); offlineTimer = null; scenario.offline_until = 0;
      clearTimeout(stealTimer); stealTimer = null;
      if (state.frame.application_name === STEAL_APP) { state.frame = { application_name: null, elements: [], ts: frameSeq++, priority: 0 }; }
      scenario.power_state = "discharging"; state.battery_charge = 100;
      logCall("POST", p, "reset"); broadcast(); return ok(res);
    }

    /* ---- emulator: network info (HTTP API card) ---- */
    if (p === "/api/_netinfo" && method === "GET") { return send(res, 200, netinfoBody()); }
    if (p === "/api/_netinfo" && method === "POST") {
      if (!isLocal(req)) return fail(res, 403, "settings can only be changed locally");   // like the device's on-box/USB config
      const b = await readJson(req);
      const notes = [];
      if (b.wifi_api !== undefined) { if (typeof b.wifi_api !== "boolean") return fail(res, 400, "Bad request: wifi_api boolean"); state.wifi_api = b.wifi_api; notes.push(`wifi_api ${b.wifi_api ? "on" : "off"}`); }
      if (b.password !== undefined) {
        if (TOKEN) return fail(res, 409, "password is managed by BUSY_API_TOKEN");
        if (typeof b.password !== "string" || b.password.length > 128) return fail(res, 400, "Bad request: password string up to 128 chars");
        state.http_token = b.password; notes.push(b.password ? "password set" : "password cleared");
      }
      if (!notes.length) return fail(res, 400, "Bad request: wifi_api or password required");
      saveState(); logCall("POST", p, notes.join(" · "));
      return send(res, 200, netinfoBody());
    }

    /* ---- emulator: hardware mirror ---- */
    if (p === "/api/_mirror" && method === "GET") { return send(res, 200, mirrorInfo()); }
    if (p === "/api/_mirror" && method === "POST") {
      const b = await readJson(req);
      if (b.host !== undefined) {
        if (typeof b.host !== "string" || b.host.length > 100) return fail(res, 400, "Bad request: host");
        state.mirror.host = b.host.trim();
      }
      if (b.token !== undefined) {
        if (typeof b.token !== "string" || b.token.length > 200) return fail(res, 400, "Bad request: token");
        state.mirror.token = b.token;
      }
      if (b.enabled !== undefined) state.mirror.enabled = !!b.enabled;
      if (!state.mirror.host) state.mirror.enabled = false;   // no target → nothing to mirror to
      if (!state.mirror.enabled) displayFlight.next = null;   // drop any coalesced frame
      setMirrorStatus(null, state.mirror.enabled ? "enabled" : "off");
      saveState(); logCall("POST", p, `${state.mirror.enabled ? "on" : "off"}${state.mirror.host ? " · " + state.mirror.host : ""}`); broadcast();
      return send(res, 200, mirrorInfo());
    }
    if (p === "/api/_mirror/test" && method === "POST") {
      const b = await readJson(req);
      const host = (typeof b.host === "string" && b.host.trim()) ? b.host.trim() : state.mirror.host;
      const token = (typeof b.token === "string" && b.token !== "") ? b.token : state.mirror.token;
      if (!host) return fail(res, 400, "Bad request: host required");
      logCall("POST", p, host);
      return send(res, 200, await mirrorProbe(host, token));
    }

    fail(res, 404, `no route for ${method} ${p}`);
  } catch (err) { fail(res, 400, err.message || "bad request"); }
});

// Device→app status stream: apps open this WebSocket for input events.
server.on("upgrade", (req, socket) => statusWs.handleUpgrade(req, socket));

server.listen(PORT, () => {
  console.log(`\n  BUSY Bar emulator running`);
  console.log(`  ├─ display : http://127.0.0.1:${PORT}/`);
  console.log(`  ├─ API base: http://127.0.0.1:${PORT}/api  (api_semver ${API_SEMVER})`);
  console.log(`  ├─ status  : ws://127.0.0.1:${PORT}/api/status/ws  (input events)`);
  console.log(`  └─ ${Object.keys(ANIMATIONS).length} device animation(s)${TOKEN ? " · X-API-Token required for non-localhost" : ""}\n`);
});
