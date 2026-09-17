import sharp from 'sharp'

// reprocess walks the whole world; libvips caches eat the box if left on
sharp.cache(false)
sharp.concurrency(1)

const VoxReader = require('@sh-dave/format-vox').VoxReader
const VoxTools = require('@sh-dave/format-vox').VoxTools

const rawPalette: number[] = VoxReader.get_DefaultPalette()
const MAGICA_RGB: [number, number, number][] = rawPalette.map((c: number, i: number) => {
  if (i === 0) return [0, 0, 0]
  const col = VoxTools.transformColor(c)
  return [col.r, col.g, col.b]
})

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

export async function encodeImageDraft(url: string, bytes?: Uint8Array): Promise<string | null> {
  try {
    let input: Buffer | Uint8Array
    if (bytes) {
      input = bytes
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) return null
      input = Buffer.from(await res.arrayBuffer())
    }
    // #region agent log
    const __g = (globalThis as any).__g
    if (__g) {
      __g.imgDraft++
      __g.imgBytes += input.byteLength
    }
    // #endregion
    // 4x4 raw RGB = 48 bytes = 64 chars b64. no texture, vertex colours on the client
    const raw = await sharp(input).resize(4, 4, { fit: 'fill' }).removeAlpha().raw().toBuffer()
    return raw.toString('base64')
  } catch {
    return null
  }
}

export function encodeVoxDraft(buffer: ArrayBuffer): Promise<string | null> {
  return new Promise((resolve) => {
    VoxReader.read(buffer, (vox: any, err: string | null) => {
      if (err || !vox?.models?.[0]?.length) return resolve(null)

      const model = vox.models[0]
      // #region agent log
      const __g = (globalThis as any).__g
      if (__g) __g.voxDraft++
      if (model.length > 300_000) (globalThis as any).__dbg?.('drafts.ts:encodeVoxDraft', 'huge vox model objects', { input: buffer.byteLength, voxels: model.length, heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576) }, 'H2')
      // #endregion
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

      let s = ''
      for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i])
      resolve(Buffer.from(s, 'binary').toString('base64'))
    })
  })
}
