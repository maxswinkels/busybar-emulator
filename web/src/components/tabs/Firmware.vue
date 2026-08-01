<template>
  <div class="panel">
    <div class="card glass">
      <div class="fw-head">
        <div class="badge" v-html="icons.chip"></div>
        <div>
          <h3 class="fw-title">Firmware</h3>
          <div class="fw-ver">{{ fw.version || '-' }}</div>
        </div>
      </div>

      <div class="fw-box">
        <dl class="fw-grid">
          <div class="pair"><dt>Version</dt><dd>{{ fw.version || '-' }}</dd></div>
          <div class="pair"><dt>Build date</dt><dd>{{ fw.build_date || '-' }}</dd></div>
          <div class="pair"><dt>Branch</dt><dd>{{ fw.branch || '-' }}</dd></div>
          <div class="pair"><dt>API version</dt><dd>{{ fw.api_semver || '-' }}</dd></div>
          <div class="pair"><dt>Commit hash</dt><dd class="mono">{{ fw.commit_hash || '-' }}</dd></div>
          <div class="pair"><dt>Uptime</dt><dd class="mono">{{ uptime }}</dd></div>
        </dl>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { apiGet, device } from '../../composables/useDevice'
import { icons } from '../../icons'

const fw = ref({})
// Live uptime from the SSE snapshot, formatted like the device (DDd HHh MMm).
const uptime = computed(() => {
  const s = device.uptime || 0
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
  return `${String(d).padStart(2, '0')}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
})

onMounted(async () => {
  const s = await apiGet('/api/status')
  fw.value = s.firmware || {}
})
</script>

<style scoped>
.fw-head { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
.fw-title { margin: 0; font-size: 21px; font-weight: 600; }
.fw-ver { color: var(--muted); font-size: 14px; margin-top: 3px; }
.fw-box { background: var(--elevated); border-radius: 12px; padding: 20px 22px; }
.fw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 36px; }
.pair { display: grid; grid-template-columns: minmax(92px, max-content) 1fr; gap: 20px; align-items: baseline; }
.pair dt { color: var(--muted); font-size: 15px; }
.pair dd { margin: 0; color: var(--text); font-size: 15px; }
.pair dd.mono { font-family: var(--mono); font-size: 13.5px; }
@media (max-width: 560px) { .fw-grid { grid-template-columns: 1fr; gap: 13px; } }
</style>
