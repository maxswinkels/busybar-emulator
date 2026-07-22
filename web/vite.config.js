import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/',
  build: { outDir: 'dist', assetsDir: 'static', emptyOutDir: true },
  server: {
    proxy: ['/api', '/events', '/animations', '/assets', '/public'].reduce(
      (a, p) => (a[p] = 'http://127.0.0.1:8080', a), {})
  }
})
