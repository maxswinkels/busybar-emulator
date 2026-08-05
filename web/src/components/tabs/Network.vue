<template>
  <div class="panel">
    <!-- HTTP API -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.httpApi"></span>HTTP API</h2>
      <div class="api-group">
        <div class="api-box">
          <div class="api-line">
            <span class="api-label">Local</span>
            <a class="api-link" :href="usbUrl + '/docs'" target="_blank" rel="noopener noreferrer">{{ usbUrl }}/docs<span class="api-ext" v-html="icons.externalLink"></span></a>
          </div>
        </div>
        <div class="api-box">
          <div class="api-line">
            <span class="api-label">Network</span>
            <a v-if="netUrl" class="api-link" :href="netUrl + '/docs'" target="_blank" rel="noopener noreferrer">{{ netUrl }}/docs<span class="api-ext" v-html="icons.externalLink"></span></a>
            <span v-else class="muted-note">no LAN address</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Mirror to hardware -->
    <div class="card glass">
      <h2 class="card-title">
        <span class="badge" v-html="icons.wifi"></span>Mirror to hardware
        <span class="pill" :class="statusPill.cls" style="margin-left:auto;font-size:11px;padding:3px 11px">{{ statusPill.text }}</span>
      </h2>

      <div class="api-group">
        <div class="api-box">
          <div class="api-line" :style="!host.trim() ? 'opacity:.55' : ''">
            <div class="api-col">
              <span>Mirror display to hardware</span>
              <span class="muted-note">{{ host.trim() ? 'Forward the emulator display to the real bar in real time.' : 'Set a host below to enable.' }}</span>
            </div>
            <button
              class="switch" :class="{ on: mirror.enabled }" role="switch"
              :aria-checked="mirror.enabled" :disabled="!host.trim()"
              @click="toggle(!mirror.enabled)"
            ><span class="knob"></span></button>
          </div>
        </div>

        <div class="api-box">
          <div class="lbl-row" style="margin-bottom:8px"><span class="lbl" style="font-size:14px">Real bar host</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <input
              class="text-input" style="flex:1;min-width:170px" type="text"
              v-model="host" placeholder="10.0.4.20  (or 10.0.4.20:8080)"
              @keydown.enter="test"
            />
            <button class="pill" :disabled="testing || !host.trim()" @click="test">{{ testing ? 'Testing…' : 'Test' }}</button>
          </div>
        </div>

        <div class="api-box">
          <div class="lbl-row" style="margin-bottom:8px">
            <span class="lbl" style="font-size:14px">API token</span>
            <span v-if="mirror.has_token && !token" class="muted-note">saved ✓</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <input
              class="text-input" style="flex:1;min-width:170px" type="password" autocomplete="off"
              v-model="token"
              :placeholder="mirror.has_token ? 'unchanged — leave blank to keep' : 'only if the bar requires one'"
            />
            <button v-if="mirror.has_token" class="pill" title="Remove the saved token" @click="clearToken">Clear</button>
          </div>
        </div>
      </div>

      <div v-if="testResult.text" class="status-line" :class="testResult.cls" style="margin-top:12px">{{ testResult.text }}</div>

      <div class="muted-note" style="margin-top:12px">
        When on, every draw, clear, brightness change and asset upload is forwarded to the bar as-is (same app name + priority),
        so the browser preview and the hardware stay in sync. The bar runs its own arbitration; forwarding is best-effort and never
        blocks the app. Point any app at the emulator as usual, no <code>--host</code> change needed.
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { device, apiGet, apiJson } from '../../composables/useDevice'
import { icons } from '../../icons'

/* ---- HTTP API card ---- */
const netinfo = ref({ port: null, addresses: [] })
const usbHost = computed(() => `127.0.0.1:${netinfo.value.port || location.port || 8080}`)
const usbUrl = computed(() => `http://${usbHost.value}`)
const netHost = computed(() => netinfo.value.addresses?.[0] ? `${netinfo.value.addresses[0]}:${netinfo.value.port}` : '')
const netUrl = computed(() => netHost.value ? `http://${netHost.value}` : '')

/* ---- Mirror card ---- */
const mirror = computed(() => device.mirror || { enabled: false, host: '', has_token: false, status: { ok: null, msg: 'off' } })

const DEFAULT_HOST = '10.0.4.20'   // the bar's usual USB-ethernet address
const host = ref('')
const token = ref('')
const testing = ref(false)
const testResult = ref({ text: '', cls: '' })

// Seed the host field once from saved config, falling back to the bar's usual
// address so a fresh install is ready to Test/Enable immediately. Never clobbers
// what the user has since typed (guarded by `seeded`).
let seeded = false
function seedHost(h) { if (seeded) return; seeded = true; host.value = (h && h.trim()) ? h : DEFAULT_HOST }
watch(() => mirror.value.host, (h) => { if (h) seedHost(h) }, { immediate: true })

const statusPill = computed(() => {
  const m = mirror.value
  if (!m.enabled) return { cls: '', text: 'off' }
  const ok = m.status?.ok
  if (ok === true) return { cls: 'good', text: 'connected' }
  if (ok === false) return { cls: 'bad', text: `error · ${m.status?.msg || 'failed'}` }
  return { cls: '', text: 'on · waiting' }
})

async function save(enabled) {
  const body = { enabled, host: host.value.trim() }
  if (token.value !== '') body.token = token.value   // omit → keep saved token
  const r = await apiJson('POST', '/api/_mirror', body)
  if (r.status === 200) { token.value = '' } // never keep the secret in the field
  return r
}

function toggle(enabled) {
  testResult.value = { text: '', cls: '' }
  save(enabled)
}

async function clearToken() {
  await apiJson('POST', '/api/_mirror', { token: '' })
  token.value = ''
}

async function test() {
  if (!host.value.trim()) return
  testing.value = true
  testResult.value = { text: '', cls: '' }
  const body = { host: host.value.trim() }
  if (token.value !== '') body.token = token.value
  const r = await apiJson('POST', '/api/_mirror/test', body)
  testing.value = false
  const j = r.json || {}
  if (j.ok) {
    const bits = [j.name && `“${j.name}”`, j.api_semver && `api ${j.api_semver}`].filter(Boolean).join(' · ')
    testResult.value = { text: `reachable${bits ? ' — ' + bits : ''}`, cls: 'ok' }
    // A good probe is a good moment to persist the host for a later enable.
    await save(mirror.value.enabled)
  } else {
    testResult.value = { text: `unreachable — ${j.error || `error ${r.status}`}`, cls: 'err' }
  }
}

onMounted(async () => {
  const n = await apiGet('/api/_netinfo')
  if (n && n.port) netinfo.value = { port: n.port, addresses: n.addresses || [] }
  const m = await apiGet('/api/_mirror')
  seedHost(m && typeof m.host === 'string' ? m.host : '')
})
</script>

<style scoped>
/* Boxes mirror the firmware's `bg-accented/25 dark:bg-elevated/75 p-4 rounded-xl`:
   elevated fill, no border, 16px padding, 12px radius, 4px gap (gap-1). */
.api-group { display: flex; flex-direction: column; gap: 4px; }
.api-box { background: var(--elevated); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; }
.api-line { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.api-col { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 14px; }
.api-label { font-size: 14px; }
.switch { position: relative; width: 44px; height: 24px; flex: none; padding: 0; border: none; border-radius: 999px; background: var(--track); cursor: pointer; transition: background .18s; }
.switch.on { background: var(--brand); }
.switch:disabled { cursor: default; opacity: .6; }
.switch .knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform .18s; }
.switch.on .knob { transform: translateX(20px); }
.api-link { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 12.5px; color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
.api-link:hover { opacity: .8; }
.api-ext { display: inline-flex; }
.api-ext :deep(svg) { width: 13px; height: 13px; }
</style>
