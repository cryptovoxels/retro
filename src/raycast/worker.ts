import * as Comlink from 'comlink'
import Config from '../../common/config'
import { bakeVoxBuffer, buildParcelMips, generateChunkBrickified, type BakedProp, type ParcelMips } from './gen'
import type { Brickified } from './bricks'

const parcels = new Map<number, ParcelMips>()
const propsByParcel = new Map<number, BakedProp[]>()

function featureUrl(url: unknown): string | null {
  if (typeof url === 'string' && url) return url
  if (Array.isArray(url) && typeof url[0] === 'string') return url[0]
  if (url && typeof url === 'object' && typeof (url as any).url === 'string') return (url as any).url
  return null
}

function resolveModelUrl(url: string): string {
  if (url.startsWith('http') || url.startsWith('//')) return Config.voxModelURL(url)
  if (url.startsWith('/')) return url
  return `${process.env.ASSET_PATH || ''}/models/${url}`
}

async function loadParcelProps(parcel: ParcelMips) {
  const out: BakedProp[] = []
  const features = parcel.features
  if (!features) {
    propsByParcel.set(parcel.id, out)
    return
  }
  for (const f of features) {
    if (f.type !== 'vox-model' && f.type !== 'megavox') continue
    const url = featureUrl(f.url)
    if (!url) continue
    const pos = f.position || [0, 0, 0]
    const scl = f.scale || [1, 1, 1]
    // ignore rotation for bake v1 — stamp axis-aligned
    void f.rotation
    try {
      const res = await fetch(resolveModelUrl(url))
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      const wx = parcel.originM[0] + (pos[0] || 0)
      const wy = parcel.originM[1] + (pos[1] || 0)
      const wz = parcel.originM[2] + (pos[2] || 0)
      // scale: feature scale * 10cm voxel
      const scale = 0.1 * Math.max(scl[0] || 1, 0.01)
      const baked = await bakeVoxBuffer(buf, wx, wy, wz, scale)
      if (baked) out.push(baked)
    } catch {
      /* skip bad prop */
    }
  }
  propsByParcel.set(parcel.id, out)
}

const api = {
  async loadParcel(input: {
    id: number
    originM: [number, number, number]
    boundsMin: [number, number, number]
    boundsMax: [number, number, number]
    voxels: string
    palette?: string[]
    features?: ParcelMips['features']
  }): Promise<boolean> {
    const mips = buildParcelMips(input.id, input.originM, input.boundsMin, input.boundsMax, input.voxels, input.palette, input.features ?? null)
    if (!mips) return false
    parcels.set(input.id, mips)
    await loadParcelProps(mips)
    return true
  },

  unloadParcel(id: number) {
    parcels.delete(id)
    propsByParcel.delete(id)
  },

  async genChunk(lod: number, cx: number, cy: number, cz: number): Promise<Brickified> {
    const list = [...parcels.values()]
    const props: BakedProp[] = []
    for (const p of propsByParcel.values()) {
      for (const b of p) props.push(b)
    }
    return generateChunkBrickified(lod, cx, cy, cz, list, props)
  },
}

export type RaycastWorkerApi = typeof api

if (typeof self !== 'undefined' && 'postMessage' in self) {
  Comlink.expose(api)
}

export default api
