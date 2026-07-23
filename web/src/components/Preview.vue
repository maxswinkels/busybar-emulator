<template>
  <div class="preview">
    <div class="busybar">
      <img class="device-illu" :src="deviceImg" alt="BUSY Bar" draggable="false" />
      <canvas class="matrix" ref="matrix" width="936" height="208" aria-label="LED matrix"></canvas>
    </div>
    <!-- back OLED is rendered but hidden (the front illustration shows only the face) -->
    <canvas class="oled" ref="oled" width="160" height="80" style="display:none" aria-hidden="true"></canvas>
    <div class="capture-row">
      <button class="cap-btn" title="Save preview.png — 720×160, the busybar-apps preview format" @click="shot"><span class="cap-ico" v-html="icons.camera"></span>PNG</button>
      <button class="cap-btn" :class="{ rec: recording }" :title="recording ? 'Stop and save preview.gif' : 'Record preview.gif — 720×160 @ 20 fps, max 30 s'" @click="toggleRec" :disabled="encoding">
        <span class="cap-ico" v-html="icons.record"></span>{{ recording ? elapsed.toFixed(1) + 's · stop' : encoding ? 'encoding…' : 'GIF' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { device, onBeep } from '../composables/useDevice'
import { createRenderer } from '../lib/renderer'
import { icons } from '../icons'
import { capturePng, createGifRecorder, download } from '../lib/capture'

const deviceImg = '/public/brand/busybar-device.png'   // runtime URL (served by the mock server)
const matrix = ref(), oled = ref()
let r = null
onMounted(() => {
  r = createRenderer(matrix.value, oled.value, () => device, () => device.frameStamp)
  r.start()
  onBeep((p) => r && r.sound(p))
})
onBeforeUnmount(() => {
  if (r) r.stop()
  if (recording.value && recorder) recorder.cancel()
  recording.value = false
})

const recording = ref(false), encoding = ref(false), elapsed = ref(0)
let recorder = null, recStopped = false

const shot = async () => { if (!matrix.value) return; const blob = await capturePng(matrix.value); download(blob, 'preview.png') }

const toggleRec = async () => {
  if (!recording.value) {
    if (!matrix.value) return
    elapsed.value = 0; recStopped = false
    recorder = createGifRecorder(matrix.value, (s) => {
      elapsed.value = s
      if (s >= 30 && !recStopped) finishRec()
    })
    recorder.start(); recording.value = true
  } else {
    finishRec()
  }
}

const finishRec = async () => {
  if (recStopped) return
  recStopped = true; recording.value = false; encoding.value = true
  const blob = await recorder.stop()
  if (blob) download(blob, 'preview.gif')
  encoding.value = false
}
</script>
