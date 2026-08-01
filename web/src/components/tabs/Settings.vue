<template>
  <div class="panel">
    <!-- sound + brightness -->
    <div class="card glass">
      <div class="split">
        <div class="col">
          <div class="col-top">
            <span class="col-ico" v-html="muted ? icons.soundOff : icons.sound"></span>
            <button class="pill" :class="{ solid: muted }" @click="toggleMute"><span v-html="icons.soundOff"></span>Mute</button>
          </div>
          <div>
            <div class="lbl-row"><span class="lbl">Sound</span><span class="lbl-val">{{ vol }}%</span></div>
            <input type="range" min="0" max="100" step="5" :class="{ muted }" :style="fill(vol)" :value="vol" @input="onVol" />
          </div>
        </div>
        <div class="col">
          <div class="col-top">
            <span class="col-ico" v-html="icons.brightness"></span>
          </div>
          <div>
            <div class="lbl-row"><span class="lbl">Brightness</span><span class="lbl-val">{{ br }}%</span></div>
            <input type="range" min="0" max="100" step="5" :style="fill(br)" :value="br" @input="onBr" />
          </div>
        </div>
      </div>
    </div>

    <!-- timezone -->
    <div class="card glass">
      <div class="tz-row">
        <div class="tz-left"><div class="badge" v-html="icons.globe"></div><span class="tz-title">Timezone</span></div>
        <select class="select" v-model="tz" @change="setTz">
          <option v-for="o in tzOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- about -->
    <div class="card glass">
      <div class="ab-head">
        <div class="badge" v-html="icons.info"></div>
        <span class="ab-title">About device</span>
      </div>
      <div class="ab-group">
        <div class="ab-box">
          <div class="ab-sub"><span class="ab-ic" v-html="icons.info"></span>General</div>
          <dl class="ab-grid">
            <div class="pair"><dt>Serial number</dt><dd class="mono">{{ about.serial || '-' }}</dd></div>
            <div class="pair"><dt>MAC address</dt><dd class="mono">{{ about.mac || '-' }}</dd></div>
            <div class="pair"><dt>Front display</dt><dd>72×16 (LED)</dd></div>
            <div class="pair"><dt>Back display</dt><dd>160×80 (OLED)</dd></div>
          </dl>
        </div>
        <div class="ab-box">
          <div class="ab-sub"><span class="ab-ic" v-html="icons.chip"></span>Firmware</div>
          <dl class="ab-grid">
            <div class="pair"><dt>Version</dt><dd>{{ fw.version || '-' }}</dd></div>
            <div class="pair"><dt>Build date</dt><dd>{{ fw.build_date || '-' }}</dd></div>
            <div class="pair"><dt>Branch</dt><dd>{{ fw.branch || '-' }}</dd></div>
            <div class="pair"><dt>API version</dt><dd>{{ fw.api_semver || '-' }}</dd></div>
            <div class="pair"><dt>Commit hash</dt><dd class="mono">{{ fw.commit_hash || '-' }}</dd></div>
            <div class="pair"><dt>Uptime</dt><dd class="mono">{{ uptime }}</dd></div>
          </dl>
        </div>
        <div class="ab-box">
          <div class="ab-sub"><span class="ab-ic" v-html="icons.wifi"></span>Network</div>
          <dl class="ab-grid">
            <div class="pair"><dt>Local</dt><dd class="mono">127.0.0.1</dd></div>
            <div class="pair"><dt>Network</dt><dd class="mono">{{ net.ip || '-' }}</dd></div>
            <div class="pair"><dt>Port</dt><dd class="mono">{{ net.port || '-' }}</dd></div>
            <div class="pair"><dt>HTTP API</dt><dd>Enabled</dd></div>
          </dl>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { device, api, apiGet } from '../../composables/useDevice'
import { icons } from '../../icons'

const fill = v => ({ '--fill': ((v - 0) / 100 * 100) + '%' })

/* volume */
const localVol = ref(null), muted = ref(false), volBeforeMute = ref(50)
const vol = computed(() => localVol.value ?? device.volume)
watch(() => device.volume, v => { if (localVol.value === null) localVol.value = v })
let volT
function onVol(e) { localVol.value = +e.target.value; muted.value = false; clearTimeout(volT); volT = setTimeout(() => { api('POST', '/api/audio/volume', { volume: vol.value }); localVol.value = null }, 130) }
function toggleMute() { if (muted.value) { muted.value = false; api('POST', '/api/audio/volume', { volume: volBeforeMute.value }) } else { volBeforeMute.value = vol.value; muted.value = true; localVol.value = 0; api('POST', '/api/audio/volume', { volume: 0 }); localVol.value = null } }

/* brightness */
const localBr = ref(null)
const br = computed(() => localBr.value ?? (device.brightness === 'auto' ? 50 : device.brightness))
let brT
function onBr(e) { localBr.value = +e.target.value; clearTimeout(brT); brT = setTimeout(() => { api('POST', '/api/display/brightness', { value: localBr.value }); localBr.value = null }, 130) }

/* timezone — format like the device: "UTC+02:00, City" with the current
   (DST-aware) offset and the city name only. */
const tz = ref(''), tzOptions = ref([])
function tzLabel(name, fallbackSec) {
  let mins = null
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'longOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''
    const m = s.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (m) mins = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3])
  } catch (_) {}
  if (mins === null) mins = Math.round((fallbackSec || 0) / 60)
  const a = Math.abs(mins)
  const city = name.includes('/') ? name.split('/').pop().replace(/_/g, ' ') : name
  return `UTC${mins < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}, ${city}`
}
async function initTz() {
  const d = await apiGet('/api/time/tzlist')
  tzOptions.value = (d.list || []).map(t => ({ value: t.name, label: tzLabel(t.name, t.offset) }))
  const cur = await apiGet('/api/time/timezone')
  tz.value = cur.name || (tzOptions.value[0] && tzOptions.value[0].value)
}
function setTz() { api('POST', '/api/time/timezone', { timezone: tz.value }) }

/* about */
const about = ref({}), fw = ref({}), net = ref({})
const uptime = computed(() => { const s = device.uptime || 0, d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return `${String(d).padStart(2, '0')}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m` })
async function initAbout() {
  const [s, n] = await Promise.all([apiGet('/api/status'), apiGet('/api/_netinfo')])
  about.value = { serial: s.device?.serial_number, mac: s.device?.usb_mac }
  fw.value = s.firmware || {}
  net.value = { ip: (n.addresses || [])[0] || '', port: n.port }
}

onMounted(() => { initTz(); initAbout() })
</script>

<style scoped>
.tz-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.tz-left { display: flex; align-items: center; gap: 14px; }
.tz-title { font-size: 19px; font-weight: 500; }

.ab-head { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
.ab-title { font-size: 21px; font-weight: 600; }
.ab-group { display: flex; flex-direction: column; gap: 4px; }
.ab-box { background: var(--elevated); border-radius: 12px; padding: 18px 20px; }
.ab-sub { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 500; margin-bottom: 15px; }
.ab-ic { display: inline-flex; color: var(--muted); }
.ab-ic :deep(svg) { width: 17px; height: 17px; }
.ab-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 36px; margin: 0; }
.pair { display: grid; grid-template-columns: minmax(108px, max-content) 1fr; gap: 18px; align-items: baseline; }
.pair dt { color: var(--muted); font-size: 14.5px; }
.pair dd { margin: 0; color: var(--text); font-size: 14.5px; word-break: break-word; }
.pair dd.mono { font-family: var(--mono); font-size: 13px; }
@media (max-width: 560px) { .ab-grid { grid-template-columns: 1fr; gap: 12px; } }
</style>
