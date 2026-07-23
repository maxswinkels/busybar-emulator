<template>
  <div class="panel">
    <div class="card glass">
      <h2 class="card-title"><span class="badge" v-html="icons.palette"></span>Draw tool</h2>
      <p class="muted-note" style="margin-top:-6px;margin-bottom:14px">Drag elements on the 72×16 grid: it's the real LED matrix (same fonts &amp; pixels as the screen above) and pushes to the bar live. Same output as <code>POST /api/display/draw</code> (app <code>draw_tool</code>).</p>

      <div class="editor-wrap">
        <div class="toolbar">
          <button class="pill" @click="addText"><span v-html="icons.text"></span>Text</button>
          <button class="pill" @click="addRect"><span v-html="icons.square"></span>Rect</button>
          <button class="pill" @click="addImage"><span v-html="icons.image"></span>Icon</button>
          <select class="select" style="min-width:0;width:auto" v-model="pickStock">
            <optgroup v-for="(list,cat) in iconCats" :key="cat" :label="cat">
              <option v-for="ic in list" :key="ic.id" :value="ic.key">{{ ic.name }}</option>
            </optgroup>
          </select>
          <div style="flex:1"></div>
          <button class="pill" @click="clearAll">Clear</button>
        </div>

        <div class="editor-stage">
          <canvas ref="cv" :width="W*cell" :height="H*cell" class="editor-canvas" @pointerdown="onDown"></canvas>
        </div>

        <div v-if="sel" class="toolbar" style="align-items:flex-end">
          <template v-if="sel.type==='text'">
            <div class="tool-field"><label>Text</label><input type="text" v-model="sel.text" /></div>
            <div class="tool-field"><label>Font</label><select v-model="sel.font"><option v-for="f in FONTS" :key="f">{{ f }}</option></select></div>
            <div class="tool-field"><label>Colour</label><input type="color" v-model="sel.color" /></div>
          </template>
          <template v-else-if="sel.type==='rect'">
            <div class="tool-field"><label>W</label><input type="text" style="width:52px" v-model.number="sel.w" /></div>
            <div class="tool-field"><label>H</label><input type="text" style="width:52px" v-model.number="sel.h" /></div>
            <div class="tool-field"><label>Fill</label><select v-model="sel.fill"><option>solid</option><option>none</option></select></div>
            <div class="tool-field"><label>Colour</label><input type="color" v-model="sel.color" /></div>
          </template>
          <template v-else>
            <div class="tool-field"><label>Icon</label><span style="font-size:13px;color:var(--muted)">{{ sel.stock }}</span></div>
          </template>
          <div class="tool-field"><label>X</label><input type="text" style="width:52px" v-model.number="sel.x" /></div>
          <div class="tool-field"><label>Y</label><input type="text" style="width:52px" v-model.number="sel.y" /></div>
          <button class="pill" @click="remove(sel.id)"><span v-html="icons.trash"></span>Delete</button>
        </div>

        <div class="layers" v-if="shapes.length">
          <div v-for="s in shapes" :key="s.id" class="layer" :class="{ sel: s.id===selId }" @click="selId=s.id">
            <span>{{ s.type }} · {{ s.type==='text' ? '"'+s.text+'"' : s.type==='image' ? s.stock : (s.w+'×'+s.h) }}</span>
            <button class="x" @click.stop="remove(s.id)">✕</button>
          </div>
          <div class="toolbar" style="margin-top:8px;gap:6px;align-items:center">
            <span style="font-size:12px;color:var(--muted)">Copy as</span>
            <button class="pill" @click="exportPython">Python</button>
            <button class="pill" @click="exportCurl">curl</button>
            <button class="pill" @click="exportJson">JSON</button>
          </div>
        </div>
        <span class="status-line" :class="statusCls">{{ status }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { apiJson, api, apiGet } from '../../composables/useDevice'
import { loadAtlas, rasterize } from '../../lib/atlas'
import { icons } from '../../icons'
import { toJson, toCurl, toPython } from '../../lib/exporters'

const W = 72, H = 16, cell = 13
const FONTS = ['tiny', 'small', 'normal', 'condensed', 'bold', 'large', 'extra_large', 'global']

const cv = ref(null)
let ctx = null
const shapes = reactive([])
const selId = ref(null)
const sel = computed(() => shapes.find(s => s.id === selId.value))
let seq = 0
const status = ref(''), statusCls = ref('status-line')

/* icons */
const iconCats = ref({}); const iconPx = {}; const pickStock = ref('faces/emoji-grinning')
onMounted(async () => {
  ctx = cv.value.getContext('2d')
  await loadAtlas(); paint()
  const cats = await apiGet('/public/icons.json'); const out = {}
  for (const cat in cats) out[cat] = cats[cat].map(ic => ({ id: ic.id, name: ic.fileName.replace(/\.svg$/, ''), key: cat + '/' + ic.fileName.replace(/\.svg$/, ''), url: '/public/icons/' + ic.path.replace(/^draw_tool\//, '') }))
  iconCats.value = out; paint()
})
function iconUrl(key) { for (const cat in iconCats.value) { const f = iconCats.value[cat].find(i => i.key === key); if (f) return f.url } return null }
function loadIcon(key) {
  if (iconPx[key]) return iconPx[key]
  const rec = { ready: false, w: 0, h: 0, px: null }; iconPx[key] = rec
  const url = iconUrl(key); const img = new Image()
  img.onload = () => { let w = img.naturalWidth || 16, h = img.naturalHeight || 16; const TH = 14; if (h > TH) { w = Math.max(1, Math.round(w * TH / h)); h = TH } const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h); try { rec.px = cx.getImageData(0, 0, w, h).data; rec.w = w; rec.h = h; rec.ready = true; paint() } catch (_) {} }
  if (url) img.src = url
  return rec
}

/* geometry + pixels */
function hex2rgb(h) { h = (h || '#ffffff').replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
function bbox(s) {
  if (s.type === 'text') { const m = rasterize(s.text || ' ', s.font); return { x: s.x, y: s.y, w: m ? m.w : 1, h: m ? m.h : 8 } }
  if (s.type === 'rect') { return { x: s.x, y: s.y, w: Math.max(1, s.w | 0), h: Math.max(1, s.h | 0) } }
  const ic = loadIcon(s.stock); return { x: s.x, y: s.y, w: ic.w || 14, h: ic.h || 14 }
}
function paintShape(grid, s) {
  if (s.type === 'text') {
    const m = rasterize(s.text || '', s.font); if (!m) return; const c = hex2rgb(s.color)
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) put(grid, s.x + x, s.y + y, c)
  } else if (s.type === 'rect') {
    const w = Math.max(1, s.w | 0), h = Math.max(1, s.h | 0), c = hex2rgb(s.color)
    if (s.fill === 'none') { for (let x = 0; x < w; x++) { put(grid, s.x + x, s.y, c); put(grid, s.x + x, s.y + h - 1, c) } for (let y = 0; y < h; y++) { put(grid, s.x, s.y + y, c); put(grid, s.x + w - 1, s.y + y, c) } }
    else for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(grid, s.x + x, s.y + y, c)
  } else {
    const ic = loadIcon(s.stock); if (!ic.ready) return
    for (let iy = 0; iy < ic.h; iy++) for (let ix = 0; ix < ic.w; ix++) { const o = (iy * ic.w + ix) * 4; if (ic.px[o + 3] < 40) continue; put(grid, s.x + ix, s.y + iy, [ic.px[o], ic.px[o + 1], ic.px[o + 2]]) }
  }
}
function put(grid, x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = c }

function paint() {
  if (!ctx) return
  const grid = new Array(W * H).fill(null)
  for (const s of shapes) paintShape(grid, s)
  ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, W * cell, H * cell)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = grid[y * W + x]
    ctx.fillStyle = c ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : '#141417'
    ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2)
  }
  const s = sel.value
  if (s) { const bb = bbox(s); ctx.strokeStyle = '#2B7FFF'; ctx.lineWidth = 1.5; ctx.strokeRect(bb.x * cell + 0.5, bb.y * cell + 0.5, bb.w * cell - 1, bb.h * cell - 1) }
}

/* interaction */
let drag = null
function toLed(e) { const r = cv.value.getBoundingClientRect(); const mx = (e.clientX - r.left) * (cv.value.width / r.width), my = (e.clientY - r.top) * (cv.value.height / r.height); return { x: Math.floor(mx / cell), y: Math.floor(my / cell) } }
function onDown(e) {
  const { x, y } = toLed(e); let picked = null
  for (let i = shapes.length - 1; i >= 0; i--) { const bb = bbox(shapes[i]); if (x >= bb.x && x < bb.x + bb.w && y >= bb.y && y < bb.y + bb.h) { picked = shapes[i]; break } }
  selId.value = picked ? picked.id : null
  if (picked) { drag = { s: picked, dx: x - picked.x, dy: y - picked.y }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp) }
  paint()
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
function onMove(e) { if (!drag) return; const { x, y } = toLed(e); drag.s.x = clamp(x - drag.dx, -60, W); drag.s.y = clamp(y - drag.dy, -16, H) }
function onUp() { drag = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }

/* shapes */
function addText() { const s = { id: 'e' + (++seq), type: 'text', x: 2, y: 4, text: 'TEXT', font: 'normal', color: '#2B7FFF' }; shapes.push(s); selId.value = s.id }
function addRect() { const s = { id: 'e' + (++seq), type: 'rect', x: 4, y: 4, w: 20, h: 8, fill: 'solid', color: '#FF7A29' }; shapes.push(s); selId.value = s.id }
function addImage() { const s = { id: 'e' + (++seq), type: 'image', x: 1, y: 1, stock: pickStock.value }; shapes.push(s); selId.value = s.id; loadIcon(s.stock) }
function remove(id) { const i = shapes.findIndex(s => s.id === id); if (i >= 0) shapes.splice(i, 1); if (selId.value === id) selId.value = null }
function clearAll() { shapes.splice(0); selId.value = null; api('DELETE', '/api/display/draw'); status.value = 'cleared'; statusCls.value = 'status-line' }

/* push (live) */
function toHex8(c) { return '0x' + (c || '#ffffff').replace('#', '').toUpperCase() + 'FF' }
function toElement(s) {
  if (s.type === 'text') return { id: s.id, type: 'text', text: s.text, x: s.x, y: s.y, font: s.font, color: toHex8(s.color) }
  if (s.type === 'rect') return { id: s.id, type: 'rectangle', x: s.x, y: s.y, width: Math.max(1, s.w | 0), height: Math.max(1, s.h | 0), border_width: 0, fill: s.fill === 'none' ? 'none' : 'solid', fill_colors: [toHex8(s.color), toHex8(s.color)] }
  return { id: s.id, type: 'image', x: s.x, y: s.y, stock_path: s.stock }
}
let pushT
function push() {
  clearTimeout(pushT)
  pushT = setTimeout(async () => {
    if (!shapes.length) { api('DELETE', '/api/display/draw'); return }
    const r = await apiJson('POST', '/api/display/draw', { application_name: 'draw_tool', priority: 50, elements: shapes.map(toElement) })
    status.value = r.status === 200 ? '200 OK · pushed ' + shapes.length + ' element' + (shapes.length === 1 ? '' : 's') : r.status + ' · ' + (r.json.error || '')
    statusCls.value = 'status-line ' + (r.status === 200 ? 'ok' : 'err')
  }, 140)
}

/* export as code */
function buildPayload() {
  return { application_name: 'draw_tool', priority: 50, elements: shapes.map(toElement) }
}
async function copyToClipboard(text, format) {
  try {
    await navigator.clipboard.writeText(text)
    status.value = `copied ${format} to clipboard`
    statusCls.value = 'status-line ok'
  } catch (e) {
    status.value = 'clipboard error: ' + (e.message || 'unknown')
    statusCls.value = 'status-line err'
  }
}
function exportJson() { copyToClipboard(toJson(buildPayload()), 'JSON') }
function exportCurl() { copyToClipboard(toCurl(buildPayload(), window.location.origin), 'curl') }
function exportPython() { copyToClipboard(toPython(buildPayload()), 'Python') }

watch(shapes, () => { paint(); push() }, { deep: true })
watch(selId, paint)
</script>
