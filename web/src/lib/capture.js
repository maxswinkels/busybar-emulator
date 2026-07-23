// capture the live matrix canvas as busybar-apps preview assets
// (720×160 = 72×16 LEDs × 10 px, per busybar-apps CONTRIBUTING.md)
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

const W = 720, H = 160

export const snapshot = (cv) => {
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cv, 0, 0, W, H)
  return out
}

export const capturePng = (cv) => new Promise(res => snapshot(cv).toBlob(res, 'image/png'))

export const createGifRecorder = (cv, onTick) => {
  let interval = null, frames = [], start = null, stopped = false
  const thumb = document.createElement('canvas')
  thumb.width = W; thumb.height = H
  const ctx = thumb.getContext('2d')

  const tick = () => {
    const elapsed = (Date.now() - start) / 1000
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cv, 0, 0, W, H)
    frames.push(new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data))
    onTick(elapsed)
    if (elapsed >= 30) { clearInterval(interval); interval = null }
  }

  const start_ = () => { start = Date.now(); frames = []; stopped = false; interval = setInterval(tick, 50) }

  const stop = async () => {
    if (stopped) return null
    stopped = true
    if (interval) { clearInterval(interval); interval = null }
    if (!frames.length) return null
    const gif = GIFEncoder()
    for (let i = 0; i < frames.length; i++) {
      const data = frames[i]
      const palette = quantize(data, 256)
      const index = applyPalette(data, palette)
      gif.writeFrame(index, W, H, { palette, delay: 50 })
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 0))
    }
    gif.finish()
    return new Blob([gif.bytes()], { type: 'image/gif' })
  }

  const cancel = () => {
    if (interval) { clearInterval(interval); interval = null }
    stopped = true
    frames = []
  }

  return { start: start_, stop, cancel }
}

export const download = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
