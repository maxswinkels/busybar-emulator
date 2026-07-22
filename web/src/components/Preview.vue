<template>
  <div class="preview">
    <div class="busybar">
      <img class="device-illu" :src="deviceImg" alt="BUSY Bar" draggable="false" />
      <canvas class="matrix" ref="matrix" width="936" height="208" aria-label="LED matrix"></canvas>
    </div>
    <!-- back OLED is rendered but hidden (the front illustration shows only the face) -->
    <canvas class="oled" ref="oled" width="160" height="80" style="display:none" aria-hidden="true"></canvas>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { device, onBeep } from '../composables/useDevice'
import { createRenderer } from '../lib/renderer'

const deviceImg = '/public/brand/busybar-device.png'   // runtime URL (served by the mock server)
const matrix = ref(), oled = ref()
let r = null
onMounted(() => {
  r = createRenderer(matrix.value, oled.value, () => device, () => device.frameStamp)
  r.start()
  onBeep(() => r && r.beep())
})
onBeforeUnmount(() => r && r.stop())
</script>
