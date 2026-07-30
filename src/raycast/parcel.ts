import Flatbush from 'flatbush'
import { vec3 } from 'wgpu-matrix'
import { Bounds } from './math/bounds'
import { VoxelData } from './math/voxeldata'

export type PRec = {
  x1: number
  y1: number
  z1: number
  x2: number
  y2: number
  z2: number
  id: number
  name?: string
  address?: string
  owner?: string
}

/** 10cm voxels: meters -> voxel indices. */
export const PARCEL_VOXELS_PER_METER = 10

/** Inclusive voxel indices along an axis for a closed meter interval [lo, hi]. */
function metersAxisToInclusiveVoxel(loM: number, hiM: number): { lo: number; hi: number } {
  const lo = Math.min(loM, hiM)
  const hi = Math.max(loM, hiM)
  const S = PARCEL_VOXELS_PER_METER
  const vLo = Math.floor(lo * S)
  const vHi = Math.max(vLo, Math.ceil(hi * S) - 1)
  return { lo: vLo, hi: vHi }
}

/**
 * JSON uses inclusive corners in **meters**; `Bounds` / `contains()` use half-open
 * [min, max) in **voxel indices**.
 */
export function parseParcelRecord(r: unknown): PRec | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (typeof o.id !== 'number') return null

  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

  const xa = num(o.x1, NaN)
  const xb = num(o.x2, xa)
  const ya = num(o.y1, 0)
  const yb = num(o.y2, ya)
  const za = num(o.z1, num(o.z2, 0))
  const zb = num(o.z2, za)

  if (!Number.isFinite(xa) || !Number.isFinite(xb)) return null

  const xr = metersAxisToInclusiveVoxel(xa, xb)
  const yr = metersAxisToInclusiveVoxel(ya, yb)
  const zr = metersAxisToInclusiveVoxel(za, zb)

  const x1 = xr.lo
  const x2 = xr.hi
  const y1 = yr.lo
  const y2 = yr.hi
  const z1 = zr.lo
  const z2 = zr.hi

  if (x2 < x1 || y2 < y1 || z2 < z1) return null

  return {
    id: o.id,
    name: typeof o.name === 'string' ? o.name : undefined,
    address: typeof o.address === 'string' ? o.address : undefined,
    owner: typeof o.owner === 'string' ? o.owner : undefined,
    x1,
    y1,
    z1,
    x2: x2 + 1,
    y2: y2 + 1,
    z2: z2 + 1,
  }
}

export class Parcel {
  readonly id: number
  bounds: Bounds
  /** World meters of the parcel origin (x1,y1,z1). */
  readonly originM: [number, number, number]
  content: ParcelContent | null = null

  constructor(record: PRec, originM: [number, number, number]) {
    this.id = record.id
    this.originM = originM
    this.bounds = new Bounds(vec3.fromValues(record.x1, record.y1, record.z1), vec3.fromValues(record.x2, record.y2, record.z2))
  }

  intersect(other: Bounds): boolean {
    return this.bounds.intersect(other)
  }

  contains(p: Parameters<Bounds['contains']>[0]): boolean {
    return this.bounds.contains(p)
  }
}

export type ParcelFeature = {
  type: string
  position?: number[]
  rotation?: number[]
  scale?: number[]
  url?: string | string[] | { url: string } | null
  [key: string]: unknown
}

export type ParcelContent = {
  voxels: string
  palette?: string[] | null
  features?: ParcelFeature[] | null
  field?: VoxelData
}

export class ParcelMap {
  private index: Flatbush | null = null
  parcels = new Map<number, Parcel>()
  ids: number[] = []

  constructor(parcels: PRec[], origins: Map<number, [number, number, number]>) {
    for (const record of parcels) {
      const origin = origins.get(record.id) ?? [0, 0, 0]
      this.parcels.set(record.id, new Parcel(record, origin))
    }

    if (parcels.length > 0) {
      this.rebuildIndex()
    } else {
      this.index = null
      this.ids = []
    }
  }

  get(id: number): Parcel | undefined {
    return this.parcels.get(id)
  }

  private rebuildIndex() {
    const count = this.parcels.size
    this.index = new Flatbush(count)
    this.ids = []

    for (const [id, parcel] of this.parcels) {
      const b = parcel.bounds
      this.index.add(b.min[0], b.min[2], b.max[0], b.max[2])
      this.ids.push(id)
    }

    this.index.finish()
  }

  search(queryBounds: Bounds): Parcel[] {
    if (!this.index) return []

    const indices = this.index.search(queryBounds.min[0], queryBounds.min[2], queryBounds.max[0], queryBounds.max[2])

    const results: Parcel[] = []
    for (const idx of indices) {
      const id = this.ids[idx]
      const parcel = this.parcels.get(id)

      if (parcel && parcel.intersect(queryBounds)) {
        results.push(parcel)
      }
    }

    return results
  }
}
