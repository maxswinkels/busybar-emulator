<template>
  <div class="panel">
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.chip"></span>Firmware</h2>
      <div class="kv">
        <span class="k">Version</span><span class="v">{{ fw.version || '-' }}</span>
        <span class="k">Target</span><span class="v">{{ fw.target || '-' }}</span>
        <span class="k">Branch</span><span class="v">{{ fw.branch || '-' }}</span>
        <span class="k">Build date</span><span class="v">{{ fw.build_date || '-' }}</span>
        <span class="k">Commit</span><span class="v">{{ fw.commit_hash || '-' }}</span>
        <span class="k">API semver</span><span class="v">{{ fw.api_semver || '-' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiGet } from '../../composables/useDevice'
import { icons } from '../../icons'
const fw = ref({})
onMounted(async () => { fw.value = await apiGet('/api/status/firmware') })
</script>
