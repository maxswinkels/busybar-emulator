<template>
  <div class="panel">
    <div class="card glass">
      <div class="row">
        <div class="rl"><div class="badge" v-html="icons.list"></div>
          <div><h3>HTTP API</h3><p>Local + remote control. api_semver <code>{{ semver }}</code></p></div></div>
        <span class="pill good">Enabled</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiGet } from '../../composables/useDevice'
import { icons } from '../../icons'
const semver = ref('-')
onMounted(async () => {
  const v = await apiGet('/api/version'); semver.value = v.api_semver || '-'
})
</script>
