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
      <div class="row">
        <div class="rl"><div class="badge" v-html="icons.globe"></div><h3>Timezone</h3></div>
        <select class="select" v-model="tz" @change="setTz">
          <option v-for="o in tzOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
    </div>

    <!-- about -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.info"></span>About</h2>
      <div class="kv">
        <span class="k">Name</span><span class="v">{{ device.name || 'BUSY-EMULATOR' }}</span>
        <span class="k">Serial</span><span class="v">{{ about.serial || '-' }}</span>
        <span class="k">Battery</span><span class="v">{{ device.battery_charge }}%</span>
        <span class="k">Uptime</span><span class="v">{{ about.uptime || '-' }}</span>
        <span class="k">API version</span><span class="v">{{ about.semver || '-' }}</span>
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

/* timezone */
const tz = ref(''), tzOptions = ref([])
async function initTz() { const d = await apiGet('/api/time/tzlist'); tzOptions.value = (d.list || []).map(t => ({ value: t.name, label: `UTC${t.offset >= 0 ? '+' : ''}${Math.floor(t.offset / 3600)}:00, ${t.name}` })); const cur = await apiGet('/api/time/timezone'); tz.value = cur.name || (tzOptions.value[0] && tzOptions.value[0].value) }
function setTz() { api('POST', '/api/time/timezone', { timezone: tz.value }) }

/* about */
const about = ref({})
async function initAbout() { const [s, v] = await Promise.all([apiGet('/api/status'), apiGet('/api/version')]); about.value = { serial: s.device?.serial_number, uptime: s.system?.uptime, semver: v.api_semver } }

onMounted(() => { initTz(); initAbout() })
</script>
