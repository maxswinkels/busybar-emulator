<template>
  <div class="panel">

    <!-- 1. Power -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.battery"></span>Power</h2>
      <div class="lbl-row"><span class="lbl">Battery</span><span class="lbl-val">{{ charge }}%</span></div>
      <input type="range" min="0" max="100" step="5" :style="fill(charge)" :value="charge" @input="onCharge" />
      <div class="chips" style="margin-top:12px">
        <button class="chip" @click="setCharge(5)">Critical 5%</button>
        <button class="chip" @click="setCharge(15)">Low 15%</button>
        <button class="chip" @click="setCharge(100)">Full 100%</button>
      </div>
      <div class="chips" style="margin-top:10px">
        <button
          v-for="s in ['discharging','charging','charged']" :key="s"
          class="pill" :class="{ solid: device.scenario?.power_state === s }"
          @click="setPowerState(s)"
        >{{ s }}</button>
      </div>
      <div class="muted-note" style="margin-top:12px">Reflected in GET /api/status/power and the header battery indicator.</div>
    </div>

    <!-- 2. Connectivity -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.wifi"></span>Connectivity</h2>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <select class="select" v-model.number="dropMs" :disabled="offlineLeft > 0">
          <option :value="5000">5 s</option>
          <option :value="15000">15 s</option>
          <option :value="30000">30 s</option>
          <option :value="60000">60 s</option>
        </select>
        <button
          class="pill" :class="offlineLeft > 0 ? 'solid' : 'brand'"
          @click="toggleOffline"
        >{{ offlineLeft > 0 ? 'Restore now' : 'Drop connection' }}</button>
      </div>
      <div v-if="offlineLeft > 0" class="status-line err">API offline — restores in {{ (offlineLeft / 1000).toFixed(1) }} s</div>
      <div v-else class="status-line"></div>
      <div class="muted-note" style="margin-top:10px">Every non-emulator /api/* request gets its connection reset, like a real USB/Wi-Fi drop. The web UI, /events and /api/_* stay reachable.</div>
    </div>

    <!-- 3. Device buttons -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.hexagon"></span>Device buttons</h2>
      <div class="chips">
        <button v-for="k in KEYS" :key="k" class="pill" @click="press(k)">{{ k }}</button>
      </div>
      <div
        class="status-line" style="margin-top:10px"
        :class="keyStatus.endsWith('OK') ? 'ok' : keyStatus ? 'err' : ''"
      >{{ keyStatus }}</div>
    </div>

    <!-- 4. Priority steal -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.square"></span>Priority steal</h2>
      <div class="lbl-row">
        <span class="lbl">Priority</span>
        <input class="app-args" type="number" min="1" max="100" v-model.number="prio" style="max-width:90px" />
      </div>
      <div class="lbl-row" style="margin-top:8px">
        <span class="lbl">Auto-release</span>
        <select class="select" v-model.number="autoMs" style="min-width:0">
          <option :value="0">manual</option>
          <option :value="5000">5 s</option>
          <option :value="15000">15 s</option>
          <option :value="30000">30 s</option>
        </select>
      </div>
      <div class="chips" style="margin-top:10px">
        <button class="pill brand" @click="steal">Steal screen</button>
        <button class="pill" :disabled="!stealActive" @click="release">Release</button>
      </div>
      <div class="kv" style="margin-top:12px">
        <span class="k">Owner</span><span class="v">{{ device.frame.application_name || '—' }}</span>
        <span class="k">Priority</span><span class="v">{{ device.frame.elements.length ? device.frame.priority : '—' }}</span>
      </div>
      <div class="status-line err" style="margin-top:8px">{{ stealStatus }}</div>
      <div class="muted-note" style="margin-top:10px">Draws a PRIORITY N frame as app _scenario.steal. A lower-priority app now gets 409 Not drawn due to low priority — run apps/clock.py to watch it cope.</div>
    </div>

    <!-- 5. Reset -->
    <div class="card glass">
      <div class="row">
        <div class="rl">
          <div class="badge" v-html="icons.trash"></div>
          <div>
            <h3>Reset scenarios</h3>
            <p>Restore power, connectivity and the display frame.</p>
          </div>
        </div>
        <button class="pill" @click="resetAll">Reset all</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { device, api, apiJson } from '../../composables/useDevice'
import { icons } from '../../icons'

const KEYS = ['up','down','ok','back','start','busy','custom','off','apps','settings']
const fill = v => ({ '--fill': v + '%' })

// ticking clock for the offline countdown (SSE only pushes on change)
const now = ref(Date.now())
let tick
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 250) })
onUnmounted(() => clearInterval(tick))

/* power — same local-ref + 130ms debounce pattern as Settings.vue */
const localCharge = ref(null)
const charge = computed(() => localCharge.value ?? device.battery_charge)
let chT
function onCharge(e) { localCharge.value = +e.target.value; clearTimeout(chT); chT = setTimeout(async () => { await apiJson('POST', '/api/_scenario/power', { battery_charge: localCharge.value }); localCharge.value = null }, 130) }
function setPowerState(s) { apiJson('POST', '/api/_scenario/power', { state: s }) }
function setCharge(n) { apiJson('POST', '/api/_scenario/power', { battery_charge: n }) }

/* connectivity */
const dropMs = ref(15000)
const offlineLeft = computed(() => Math.max(0, (device.scenario?.offline_until || 0) - now.value))
function toggleOffline() {
  if (offlineLeft.value > 0) apiJson('POST', '/api/_scenario/offline', {})
  else apiJson('POST', '/api/_scenario/offline', { duration_ms: +dropMs.value })
}

/* buttons */
const keyStatus = ref('')
async function press(k) {
  const r = await api('POST', '/api/input', { key: k })
  keyStatus.value = r.status === 200 ? `key "${k}" → OK` : r.status === 0 ? `key "${k}" → no response (device offline?)` : `key "${k}" → ${r.status} ${r.json.error || ''}`
}

/* priority steal */
const prio = ref(99), autoMs = ref(15000)
const stealStatus = ref('')
const stealActive = computed(() => device.frame.application_name === '_scenario.steal' && device.frame.elements.length > 0)
async function steal() {
  stealStatus.value = ''
  const body = { priority: +prio.value }
  if (+autoMs.value > 0) body.duration_ms = +autoMs.value
  const r = await apiJson('POST', '/api/_scenario/steal', body)
  if (r.status !== 200) stealStatus.value = r.status === 409 ? '409 — current frame has a higher priority' : (r.json.error || `Error ${r.status}`)
}
function release() { api('DELETE', '/api/display/draw', { application_name: '_scenario.steal' }) }

function resetAll() { apiJson('POST', '/api/_scenario/reset', {}) }
</script>
