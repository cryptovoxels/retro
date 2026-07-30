import { mat4, quat, vec3, type Mat4 } from 'wgpu-matrix'
import Config from '../../common/config'
import { computeAabb } from './math/maths'
import { VoxelData } from './math/voxeldata'
import { nearestPaletteIndexFromRgb } from './palette'
import { Mesh } from './scene'

const VoxReader = require('@sh-dave/format-vox').VoxReader

let nextPropId = 1

function parseVox(buffer: ArrayBuffer): Promise<any> {
  return new Promise((resolve, reject) => {
    VoxReader.read(buffer, (vox: any, errstr: string | null) => {
      if (errstr || !vox?.models?.[0]) reject(errstr || 'Unable to load a model')
      else resolve(vox)
    })
  })
}

export class Prop extends Mesh {
  readonly id: number
  ready = false

  private _boundsCache:
    | {
        minX: number
        minY: number
        minZ: number
        maxX: number
        maxY: number
        maxZ: number
        dimsX: number
        dimsY: number
        dimsZ: number
      }
    | undefined

  constructor(id?: number) {
    super()
    this.id = id ?? nextPropId++
  }

  async loadUrl(url: string) {
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const buf = await res.arrayBuffer()
      await this.loadBuffer(buf)
    } catch (e) {
      console.error('raycast prop load failed', url, e)
    }
  }

  async loadBuffer(buffer: ArrayBuffer) {
    const vox = await parseVox(buffer)
    const size = vox.sizes[0] as { x: number; y: number; z: number }
    // todo: one .vox voxel = one 10cm raycast voxel; may read wrong visually
    this.shape = vec3.fromValues(size.x, size.y, size.z)
    this.data = new VoxelData(this.shape)
    // shader treats 0xff as air (not 0)
    this.data.words.fill(0xffff_ffff)

    const palette = vox.palette as { r: number; g: number; b: number; a: number }[]
    const model = vox.models[0] as { x: number; y: number; z: number; colorIndex: number }[]
    const p = vec3.create()
    for (const row of model) {
      const c = palette[row.colorIndex]
      if (!c || c.a < 10) continue
      const clr = nearestPaletteIndexFromRgb(c.r / 255, c.g / 255, c.b / 255)
      // magica y-up; flip Y so ground sits at y=0
      vec3.set(row.x, size.y - 1 - row.y, row.z, p)
      this.data.set(p, clr)
    }
    this.ready = true
    this.flush()
  }

  /** world-from-local with voxel scale + center pivot (art instance matrix). */
  worldFromLocal(voxelWorldScale = 0.1): Mat4 {
    const sx = this.data.shape[0]
    const sy = this.data.shape[1]
    const sz = this.data.shape[2]
    const pivot = vec3.fromValues(sx * 0.5, sy * 0.5, sz * 0.5)
    const negPivot = vec3.create(0, 0, 0)
    vec3.scale(pivot, -1, negPivot)

    const out = mat4.clone(this.getWorldMatrix())
    // bake voxel scale + pivot into the mesh world matrix
    mat4.scale(out, vec3.fromValues(voxelWorldScale, voxelWorldScale, voxelWorldScale), out)
    mat4.translate(out, negPivot, out)
    return out
  }

  flush(voxelWorldScale = 0.1) {
    this.markDirty()
    const sx = Math.max(1, Math.floor(this.shape[0]))
    const sy = Math.max(1, Math.floor(this.shape[1]))
    const sz = Math.max(1, Math.floor(this.shape[2]))
    const matrix = this.worldFromLocal(voxelWorldScale)
    const aabb = computeAabb(matrix, vec3.create(0, 0, 0), vec3.create(sx, sy, sz))
    this._boundsCache = {
      minX: aabb.x1,
      minY: aabb.y1,
      minZ: aabb.z1,
      maxX: aabb.x2,
      maxY: aabb.y2,
      maxZ: aabb.z2,
      dimsX: sx,
      dimsY: sy,
      dimsZ: sz,
    }
  }

  worldBounds(voxelWorldScale = 0.1) {
    if (!this._boundsCache) this.flush(voxelWorldScale)
    return this._boundsCache!
  }
}

function featureUrl(url: unknown): string | null {
  if (typeof url === 'string' && url) return url
  if (Array.isArray(url) && typeof url[0] === 'string') return url[0]
  if (url && typeof url === 'object' && typeof (url as any).url === 'string') return (url as any).url
  return null
}

/** Build props from nearby parcel vox-model features. Cap at max. */
export async function loadPropsFromParcels(
  parcels: Array<{
    originM: [number, number, number]
    content: { features?: Array<{ type: string; position?: number[]; rotation?: number[]; scale?: number[]; url?: unknown }> | null } | null
  }>,
  max = 128,
): Promise<Prop[]> {
  const props: Prop[] = []
  for (const parcel of parcels) {
    const features = parcel.content?.features
    if (!features) continue
    for (const f of features) {
      if (f.type !== 'vox-model' && f.type !== 'megavox') continue
      const url = featureUrl(f.url)
      if (!url) continue
      if (props.length >= max) return props

      const prop = new Prop()
      const pos = f.position || [0, 0, 0]
      const rot = f.rotation || [0, 0, 0]
      const scl = f.scale || [1, 1, 1]
      // feature position is parcel-local meters
      vec3.set(parcel.originM[0] + (pos[0] || 0), parcel.originM[1] + (pos[1] || 0), parcel.originM[2] + (pos[2] || 0), prop.position)
      quat.fromEuler(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'yxz', prop.rotationQuaternion)
      vec3.set(scl[0] || 1, scl[1] || 1, scl[2] || 1, prop.scaling)
      prop.markDirty()
      props.push(prop)
      const resolved = url.startsWith('http') || url.startsWith('//') ? Config.voxModelURL(url) : url.startsWith('/') ? url : `${process.env.ASSET_PATH || ''}/models/${url}`
      void prop.loadUrl(resolved)
    }
  }
  return props
}
