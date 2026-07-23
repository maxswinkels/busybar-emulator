<template>
  <div class="panel">
    <!-- app list -->
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.play"></span>Apps</h2>
      <div class="apps-list">
        <div
          v-for="app in appList" :key="app.name"
          class="app-row" :class="{ running: device.app.name === app.name && device.app.running }"
        >
          <div class="app-row-info">
            <div class="app-name-row">
              <span class="app-name">{{ app.name.split('/').pop() }}</span>
              <span v-if="app.local" class="app-tag">local</span>
            </div>
            <span class="app-desc">{{ app.description }}</span>
          </div>
          <div class="app-row-controls" v-if="app.params && app.params.length">
            <template v-for="param in app.params" :key="param.key">
              <select
                v-if="param.type === 'select'"
                class="app-args"
                v-model="paramValues[app.name + '.' + param.key]"
              >
                <option v-for="opt in param.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
              <input
                v-else-if="param.type === 'text'"
                class="app-args"
                type="text"
                v-model="paramValues[app.name + '.' + param.key]"
                :placeholder="param.placeholder || param.label"
                @keydown.enter="run(app)"
              />
            </template>
          </div>
          <div class="app-row-controls">
            <button
              class="pill"
              :class="device.app.name === app.name && device.app.running ? 'solid' : 'brand'"
              @click="device.app.name === app.name && device.app.running ? stop() : run(app)"
            >
              {{ device.app.name === app.name && device.app.running ? 'Stop' : 'Run' }}
            </button>
          </div>
        </div>
        <div v-if="!appList.length" class="muted-note" style="padding:8px 0">No apps found.</div>
      </div>
      <div v-if="startError" class="status-line err" style="margin-top:10px">{{ startError }}</div>
    </div>

    <!-- terminal -->
    <div class="term" ref="termEl">
      <div class="term-bar">
        <span class="term-dots"><i></i><i></i><i></i></span>
        <span class="term-title">{{ device.app.name ? cmdLine : 'terminal' }}</span>
        <span class="term-status" v-if="device.app.name" :class="status.cls">
          <i class="dot"></i>{{ status.text }}
        </span>
      </div>
      <div class="term-body" ref="logEl">
        <template v-if="device.app.name">
          <div class="term-line cmd"><span class="prompt">$</span> {{ cmdLine }}</div>
          <div
            v-for="(line, i) in device.app.output" :key="i"
            class="term-line" :class="{ err: line.s === 'err' }"
          >{{ line.line }}</div>
          <div v-if="device.app.error" class="term-line err">✖ {{ device.app.error }}</div>
          <div v-if="device.app.running" class="term-line"><span class="caret"></span></div>
          <div v-else-if="!device.app.error" class="term-line exit" :class="{ err: device.app.exitCode !== 0 }">— exited with code {{ device.app.exitCode }} —</div>
        </template>
        <template v-else>
          <div class="term-line muted"># run an example app above — its output appears here</div>
          <div class="term-line cmd"><span class="prompt">$</span> <span class="caret"></span></div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { device, apiJson, apiGet } from '../../composables/useDevice'
import { icons } from '../../icons'

const appList = ref([])
// flat map: "appname.paramkey" -> current value
const paramValues = ref({})
const startError = ref('')
const logEl = ref(null)
const termEl = ref(null)
// args of the run started from this page (server state doesn't carry args)
const lastArgs = ref([])

const cmdLine = computed(() =>
  ['python3', `apps/${device.app.name}.py`, ...lastArgs.value].join(' ')
)
const status = computed(() => {
  if (device.app.running) return { cls: 'run', text: `running · pid ${device.app.pid}` }
  if (device.app.error) return { cls: 'err', text: device.app.error }
  return { cls: device.app.exitCode === 0 ? 'ok' : 'err', text: `exited · code ${device.app.exitCode}` }
})

onMounted(async () => {
  const d = await apiGet('/api/_apps')
  appList.value = d.apps || []
  // seed default values for select params
  for (const app of appList.value) {
    for (const param of (app.params || [])) {
      const k = app.name + '.' + param.key
      if (paramValues.value[k] === undefined) {
        paramValues.value[k] = param.default ?? ''
      }
    }
  }
})

function buildArgs(app) {
  const args = []
  for (const param of (app.params || [])) {
    const val = paramValues.value[app.name + '.' + param.key] ?? ''
    if (param.positional) {
      if (val) args.push(val)
    } else if (param.flag) {
      if (val) args.push(param.flag, val)
    }
  }
  return args
}

async function run(app) {
  startError.value = ''
  const args = buildArgs(app)
  const r = await apiJson('POST', '/api/_apps/start', { name: app.name, args })
  if (r.status !== 200) { startError.value = r.json.error || `Error ${r.status}`; return }
  lastArgs.value = args
}

async function stop() {
  startError.value = ''
  await apiJson('POST', '/api/_apps/stop', {})
}

// auto-scroll when near bottom
function maybeScroll() {
  if (!logEl.value) return
  const el = logEl.value
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  if (nearBottom) nextTick(() => { el.scrollTop = el.scrollHeight })
}

watch(() => device.app.output?.length, () => { maybeScroll() })

// bring the terminal into view when a run starts
watch(() => device.app.running, (running) => {
  if (running) nextTick(() => termEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
})
</script>
