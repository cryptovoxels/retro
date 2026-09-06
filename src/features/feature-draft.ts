import { rebindGizmos } from '../tools/gizmos'
import Feature from './feature'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const VoxTools = require('@sh-dave/format-vox').VoxTools

const rawPalette: number[] = VoxReader.get_DefaultPalette()
const MAGICA_RGB: [number, number, number][] = rawPalette.map((c: number, i: number) => {
  if (i === 0) return [0, 0, 0]
  const col = VoxTools.transformColor(c)
  return [col.r, col.g, col.b]
})
const MAGICA_PALETTE: BABYLON.Color3[] = MAGICA_RGB.map(([r, g, b]) => new BABYLON.Color3(r / 255, g / 255, b / 255))
Object.freeze(MAGICA_PALETTE)
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

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export async function encodeImageDraft(url: string): Promise<string | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 8, 8)
    const dataUrl = canvas.toDataURL('image/webp', 0.8)
    const prefix = 'data:image/webp;base64,'
    if (!dataUrl.startsWith(prefix)) return null
    return dataUrl.slice(prefix.length)
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

      resolve(bytesToB64(out))
    })
  })
}

export function persistDraft(feature: Feature, draft: string | null) {
  if (!draft || !feature.parcel?.canEdit || draft === (feature.description as any).draft) return
  ;(feature.description as any).draft = draft
  feature.sendToServer(['draft' as any])
}

export function renderImageDraft(feature: Feature, b64: string) {
  if (feature.disposed) return
  const f = feature as any

  const material = new BABYLON.StandardMaterial(f.uniqueEntityName('material'), feature.scene)
  material.specularColor.set(0, 0, 0)
  material.diffuseColor.set(1, 1, 1)
  material.emissiveColor.set(1, 1, 1)
  material.diffuseTexture = new BABYLON.Texture('data:image/webp;base64,' + b64, feature.scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE)
  material.backFaceCulling = false

  if (!(feature.mesh instanceof BABYLON.Mesh)) {
    feature.mesh = BABYLON.MeshBuilder.CreatePlane(f.uniqueEntityName('mesh'), { size: 1 }, feature.scene)
    rebindGizmos(feature)
  }

  ;(feature.mesh as BABYLON.Mesh).material = material
  f.setCommon()
}

export function renderVoxDraft(feature: Feature, b64: string) {
  if (feature.disposed) return
  const f = feature as any

  const bytes = b64ToBytes(b64)
  if (bytes.length !== 64) return

  const scene = feature.scene
  const cell = 1 / 4
  const boxes: BABYLON.Mesh[] = []

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const pi = bytes[x + y * 4 + z * 16]
        if (!pi) continue
        const color = MAGICA_PALETTE[pi] || MAGICA_PALETTE[1]
        const box = BABYLON.MeshBuilder.CreateBox(f.uniqueEntityName('mesh'), { size: cell * 0.95 }, scene)
        box.position.set((x - 1.5) * cell, (y - 1.5) * cell, (z - 1.5) * cell)
        const vd = BABYLON.VertexData.ExtractFromMesh(box)
        const n = vd.positions!.length / 3
        const colors = new Float32Array(n * 4)
        for (let i = 0; i < n; i++) {
          colors[i * 4] = color.r
          colors[i * 4 + 1] = color.g
          colors[i * 4 + 2] = color.b
          colors[i * 4 + 3] = 1
        }
        vd.colors = colors
        vd.applyToMesh(box)
        boxes.push(box)
      }
    }
  }

  if (!boxes.length) return

  const merged = BABYLON.Mesh.MergeMeshes(boxes, true, true, undefined, false, true)
  if (!merged) return

  const mat = new BABYLON.StandardMaterial(f.uniqueEntityName('material'), scene)
  mat.specularColor.set(0, 0, 0)
  mat.disableLighting = true
  ;(mat as any).useVertexColors = true

  if (!(feature.mesh instanceof BABYLON.Mesh)) {
    feature.mesh = merged
    rebindGizmos(feature)
  } else {
    const old = feature.mesh as BABYLON.Mesh
    BABYLON.VertexData.ExtractFromMesh(merged).applyToMesh(old)
    merged.material = null
    merged.dispose()
    feature.mesh = old
  }

  ;(feature.mesh as BABYLON.Mesh).material = mat
  f.setCommon()
}
