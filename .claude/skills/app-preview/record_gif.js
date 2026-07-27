// Page-context snippet for mcp__playwright__browser_evaluate.
// Records SECONDS of the matrix canvas at 20 fps, encodes a 720×160 GIF with
// gifenc (same encoder/settings as the UI's Rec button, loaded from unpkg —
// its own ESM build; the esm.sh build lacks the named exports),
// and stores it in emulator storage so the skill can curl it out afterwards.
// Edit SECONDS before evaluating; keep it ≤ 15 (storage body cap is 8 MB).
async () => {
  const SECONDS = 6
  const { GIFEncoder, quantize, applyPalette } = await import('https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js')
  const cv = document.querySelector('canvas.matrix')
  if (!cv) throw new Error('canvas.matrix not found — is the emulator UI loaded?')
  const W = 720, H = 160
  const thumb = document.createElement('canvas')
  thumb.width = W; thumb.height = H
  const ctx = thumb.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const frames = []
  await new Promise(done => {
    const iv = setInterval(() => {
      ctx.drawImage(cv, 0, 0, W, H)
      frames.push(new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data))
      if (frames.length >= SECONDS * 20) { clearInterval(iv); done() }
    }, 50)
  })
  const gif = GIFEncoder()
  for (const data of frames) {
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, W, H, { palette, delay: 50 })
  }
  gif.finish()
  const blob = new Blob([gif.bytes()], { type: 'image/gif' })
  const res = await fetch('/api/storage/write?path=_preview.gif', { method: 'POST', body: blob })
  if (!res.ok) throw new Error('storage write failed: ' + res.status)
  return { bytes: blob.size, frames: frames.length }
}
