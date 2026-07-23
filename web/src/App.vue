<template>
  <div class="wrap">
    <header class="app-header">
      <div class="h-left">
        <span class="logo" v-html="logoSvg" @click="cycleTheme"></span>
        <span class="conn"><span class="ci" v-html="icons.usb"></span>Connected<span class="host">{{ host }}</span></span>
      </div>
      <div class="h-center">BUSY Bar Emulator</div>
      <div class="h-right">
        <span class="batt"><span class="bico" :class="{ live: device.connected }" v-html="icons.battery"></span>{{ device.battery_charge }}%</span>
        <button class="icon-btn" title="Toggle light / dark" @click="toggleTheme">{{ themeGlyph }}</button>
      </div>
    </header>

    <Preview />

    <div class="content-grid">
      <Tabs v-model="tab" />
      <main>
        <TabSettings v-if="tab === 'settings'" />
        <TabNetwork v-else-if="tab === 'network'" />
        <TabFirmware v-else-if="tab === 'firmware'" />
        <TabDrawTool v-else-if="tab === 'draw-tool'" />
        <TabApps v-else-if="tab === 'apps'" />
        <TabScenarios v-else-if="tab === 'scenarios'" />
      </main>
    </div>

    <footer class="app-footer">
      <span>© {{ year }} <a href="https://github.com/maxswinkels" target="_blank" rel="noopener">Max Swinkels</a> · <a href="https://github.com/maxswinkels/busybar-emulator/blob/main/LICENSE" target="_blank" rel="noopener">MIT license</a></span>
      <span>Unofficial project. "BUSY Bar" is a trademark of <a href="https://busy.app" target="_blank" rel="noopener">Flipper Devices</a>. Bundled fonts &amp; artwork © Flipper Devices (CC-BY 4.0 / SIL OFL 1.1).</span>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { device } from './composables/useDevice'
import { icons } from './icons'
import Preview from './components/Preview.vue'
import Tabs from './components/Tabs.vue'
import TabSettings from './components/tabs/Settings.vue'
import TabNetwork from './components/tabs/Network.vue'
import TabFirmware from './components/tabs/Firmware.vue'
import TabDrawTool from './components/tabs/DrawTool.vue'
import TabApps from './components/tabs/Apps.vue'
import TabScenarios from './components/tabs/Scenarios.vue'

const tab = ref('settings')
const host = location.host || '127.0.0.1:8080'
const year = new Date().getFullYear()

const logoSvg = ref('')
onMounted(() => { fetch('/public/brand/logo-white.svg').then(r => r.text()).then(t => logoSvg.value = t).catch(() => {}) })

const root = document.documentElement
const saved = localStorage.getItem('bb-theme')
if (saved) root.setAttribute('data-theme', saved)
const themeState = ref(cur())
function cur() { return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light') }
const themeGlyph = computed(() => themeState.value === 'dark' ? '☀' : '☾')
function toggleTheme() { const n = cur() === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', n); localStorage.setItem('bb-theme', n); themeState.value = n }
function cycleTheme() { toggleTheme() }
</script>
