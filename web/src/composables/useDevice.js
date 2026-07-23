import { reactive } from 'vue'

// Live device state, mirrored from the mock server over SSE.
export const device = reactive({
  frame: { application_name: null, elements: [], ts: 0 },
  brightness: 80, volume: 60, battery_charge: 0, name: '', uptime: 0,
  log: [], connected: false, frameStamp: performance.now() / 1000, _lastTs: -1,
  app: { running: false, name: null, pid: null, startedAt: null, exitCode: null, error: null, output: [] },
})

let beepCb = null
export function onBeep(cb) { beepCb = cb }

function apply(st) {
  const lastTs = device._lastTs
  Object.assign(device, st)
  if (st.frame.ts !== lastTs) { device._lastTs = st.frame.ts; device.frameStamp = performance.now() / 1000 }
}

function connect() {
  const es = new EventSource('/events')
  es.addEventListener('state', e => { try { apply(JSON.parse(e.data)) } catch (_) {} })
  es.addEventListener('beep', (e) => { let p = {}; try { p = JSON.parse(e.data || '{}') } catch (_) {} beepCb && beepCb(p) })
  es.onopen = () => { device.connected = true }
  es.onerror = () => { device.connected = false }
}
connect()

// Query-param API call (POST/GET/DELETE with ?query).
export async function api(method, path, query) {
  const url = path + (query ? '?' + new URLSearchParams(query) : '')
  try { const r = await fetch(url, { method }); return { status: r.status, json: await r.json().catch(() => ({})) } }
  catch (_) { return { status: 0, json: {} } }
}
// JSON-body API call.
export async function apiJson(method, path, body) {
  try { const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
  catch (_) { return { status: 0, json: {} } }
}
export async function apiGet(path) { try { return await (await fetch(path)).json() } catch (_) { return {} } }
