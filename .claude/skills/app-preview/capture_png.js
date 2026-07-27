// Page-context snippet for mcp__playwright__browser_evaluate.
// Scales the live matrix canvas to 720×160 (same as the UI's PNG button /
// busybar-apps CONTRIBUTING.md) and stores it in emulator storage so the
// skill can curl it out afterwards.
async () => {
  const cv = document.querySelector('canvas.matrix')
  if (!cv) throw new Error('canvas.matrix not found — is the emulator UI loaded?')
  const out = document.createElement('canvas')
  out.width = 720; out.height = 160
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cv, 0, 0, 720, 160)
  const blob = await new Promise(r => out.toBlob(r, 'image/png'))
  const res = await fetch('/api/storage/write?path=_preview.png', { method: 'POST', body: blob })
  if (!res.ok) throw new Error('storage write failed: ' + res.status)
  return { bytes: blob.size }
}
