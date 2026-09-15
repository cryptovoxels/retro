import sharp from 'sharp'

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

export async function encodeImageDraft(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const webp = await sharp(buf).resize(8, 8).webp({ quality: 80 }).toBuffer()
    return webp.toString('base64')
  } catch {
    return null
  }
}

export function encodeVoxDraft(buffer: ArrayBuffer): Promise<string | null> {
  return new Promise((resolve) => {
    VoxReader.read(buffer, (vox: any, err: string | null) => {
      if (err || !vox?.models?.[0]?.length) return resolve(null)

      const model = vox.models[0]
      let minX = Infinity
      let minY = Infinity
      let minZ = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let maxZ = -Infinity
      for (const v of model) {
        minX = Math.min(minX, v.x)
        minY = Math.min(minY, v.y)
        minZ = Math.min(minZ, v.z)
        maxX = Math.max(maxX, v.x)
        maxY = Math.max(maxY, v.y)
        maxZ = Math.max(maxZ, v.z)
      }

      const cells: number[][] = Array.from({ length: 64 }, () => [])
      const rx = Math.max(1, maxX - minX)
      const ry = Math.max(1, maxY - minY)
      const rz = Math.max(1, maxZ - minZ)

      for (const v of model) {
        const cx = Math.min(3, Math.floor(((v.x - minX) / rx) * 3.999))
        const cy = Math.min(3, Math.floor(((v.y - minY) / ry) * 3.999))
        const cz = Math.min(3, Math.floor(((v.z - minZ) / rz) * 3.999))
        const cell = cx + cy * 4 + cz * 16
        const { r, g, b } = vox.palette[v.colorIndex] || { r: 0, g: 0, b: 0 }
        cells[cell].push(nearestIndex(r, g, b))
      }

      const out = new Uint8Array(64)
      for (let i = 0; i < 64; i++) {
        const hits = cells[i]
        if (!hits.length) continue
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
        out[i] = best
      }

      let s = ''
      for (let i = 0; i < out.length; i++) s += String.fromCharCode(out[i])
      resolve(Buffer.from(s, 'binary').toString('base64'))
    })
  })
}
