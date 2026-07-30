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
