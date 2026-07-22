<template>
  <div class="tabs" role="tablist">
    <div
      v-for="t in options" :key="t.v"
      class="tab" :class="{ active: modelValue === t.v }"
      role="tab" :aria-selected="modelValue === t.v"
      @click="$emit('update:modelValue', t.v)"
    >
      <span v-html="t.icon"></span>
      <span>{{ t.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { icons } from '../icons'
defineProps({ modelValue: String })
defineEmits(['update:modelValue'])
const options = [
  { v: 'network', label: 'Network', icon: icons.wifi },
  { v: 'firmware', label: 'Firmware', icon: icons.chip },
  { v: 'settings', label: 'Settings', icon: icons.hexagon },
  { v: 'draw-tool', label: 'Draw tool', icon: icons.palette },
  { v: 'apps', label: 'Apps', icon: icons.play },
]
</script>
