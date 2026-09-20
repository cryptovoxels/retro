import Feature from './feature'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const VoxTools = require('@sh-dave/format-vox').VoxTools

const rawPalette: number[] = VoxReader.get_DefaultPalette()
const MAGICA_RGB: [number, number, number][] = rawPalette.map((c: number, i: number) => {
  if (i === 0) return [0, 0, 0]
  const col = VoxTools.transformColor(c)
  return [col.r, col.g, col.b]
})
Object.freeze(MAGICA_RGB)

function nearestIndex(r: number, g: number, b: number): number {
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < 256; i++) {
    const [pr, pg, pb] = MAGICA_RGB[i]
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export async function encodeImageDraft(url: string): Promise<string | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 4, 4)
    const { data } = ctx.getImageData(0, 0, 4, 4)
    const out = new Uint8Array(48)
    for (let i = 0, j = 0; i < 16; i++, j += 3) {
      out[j] = data[i * 4]
      out[j + 1] = data[i * 4 + 1]
      out[j + 2] = data[i * 4 + 2]
    }
    return bytesToB64(out)
  } catch {
    return null
  }
}

export function encodeVoxDraft(buffer: ArrayBuffer): Promise<string | null> {
  return new Promise((resolve) => {
    VoxReader.read(buffer, (vox: any, err: string | null) => {
      if (err || !vox?.models?.[0]?.length) return resolve(null)

      const model = vox.models[0]
      // bucket on the SIZE chunk, not the occupied bbox, so cells land where vox-reader puts the real voxels
      const size = vox.sizes?.[0] || { x: 1, y: 1, z: 1 }
      const sx = Math.max(1, size.x)
      const sy = Math.max(1, size.y)
      const sz = Math.max(1, size.z)

      const cells: number[][] = Array.from({ length: 64 }, () => [])
      for (const v of model) {
        const cx = Math.min(3, Math.floor((v.x / sx) * 4))
        const cy = Math.min(3, Math.floor((v.y / sy) * 4))
        const cz = Math.min(3, Math.floor((v.z / sz) * 4))
        cells[cx + cy * 4 + cz * 16].push(v.colorIndex)
      }

      // 64 cells + 3 size bytes so the client can draw it at the real footprint
      const out = new Uint8Array(67)
      out[64] = Math.min(255, sx)
      out[65] = Math.min(255, sy)
      out[66] = Math.min(255, sz)
      for (let i = 0; i < 64; i++) {
        const hits = cells[i]
        if (!hits.length) continue
        // most common source palette index in the block, then snap that colour to the standard palette
        const freq = new Map<number, number>()
        for (const c of hits) freq.set(c, (freq.get(c) || 0) + 1)
        let best = hits[0]
        let bestN = 0
        for (const [c, n] of freq) {
          if (n > bestN) {
            bestN = n
            best = c
          }
        }
        // no RGBA chunk means the file already uses the standard palette
        const col = vox.palette?.[best]
        out[i] = col ? nearestIndex(col.r, col.g, col.b) : best
      }

      resolve(bytesToB64(out))
    })
  })
}

export function persistDraft(feature: Feature, draft: string | null) {
  if (!draft || !feature.parcel?.canEdit || draft === (feature.description as any).draft) return
  ;(feature.description as any).draft = draft
  feature.sendToServer(['draft' as any])
}
