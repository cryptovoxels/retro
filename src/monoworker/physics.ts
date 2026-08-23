import type { NdArray } from 'ndarray'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const empty = new Int32Array(0)

/** Int32Array of (x,y,z) grid coords for every filled cell. */
export function voxelCollider(field: NdArray<Uint16Array>): Int32Array
export function voxelCollider(shape: [number, number, number], data: Uint16Array): Int32Array
export function voxelCollider(shapeOrField: [number, number, number] | NdArray<Uint16Array>, data?: Uint16Array): Int32Array {
  if (!Array.isArray(shapeOrField)) {
    const field = shapeOrField
    const [sx, sy, sz] = field.shape
    const out: number[] = []
    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        for (let z = 0; z < sz; z++) {
          if (field.get(x, y, z)) out.push(x, y, z)
        }
      }
    }
    return new Int32Array(out)
  }

  const [sx, sy, sz] = shapeOrField
  const out: number[] = []
  let i = 0
  for (let x = 0; x < sx; x++) {
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        if (data![i++] !== 0) out.push(x, y, z)
      }
    }
  }
  return new Int32Array(out)
}

function gridDims(size: { x: number; y: number; z: number }, shift: number) {
  const m = 1 << shift
  return {
    gx: (size.x + m - 1) >> shift,
    gy: (size.y + m - 1) >> shift,
    gz: (size.z + m - 1) >> shift,
  }
}

function localCoord(x: number, y: number, z: number, gx: number, gy: number, gz: number) {
  return [x - Math.floor(gx / 2), z - Math.floor(gz / 2), Math.floor(gy / 2) - y]
}

function downsampleBuf(buf: ArrayBuffer, shift: number): Promise<Int32Array> {
  return new Promise((resolve) => {
    VoxReader.read(buf, (vox: any, errstr: string | null) => {
      if (errstr || !vox?.models?.[0]) return resolve(empty)
      const size = vox.sizes[0]
      const { gx, gy, gz } = gridDims(size, shift)
      const occ = new Uint8Array(gx * gy * gz)
      const at = (x: number, y: number, z: number) => x + y * gx + z * gx * gy
      vox.models[0].forEach((row: any) => {
        const x = row.x >> shift
        const y = row.y >> shift
        const z = row.z >> shift
        if (x < 0 || y < 0 || z < 0 || x >= gx || y >= gy || z >= gz) return
        occ[at(x, y, z)] = 1
      })
      const out: number[] = []
      for (let x = 0; x < gx; x++) {
        for (let y = 0; y < gy; y++) {
          for (let z = 0; z < gz; z++) {
            if (!occ[at(x, y, z)]) continue
            out.push(...localCoord(x, y, z, gx, gy, gz))
          }
        }
      }
      resolve(out.length ? new Int32Array(out) : empty)
    })
  })
}

/** 16^3 occupancy from a wearable .vox. Any filled 2x2x2 of the 32^3 source is one cell. */
export async function wearVoxels(url: string): Promise<Int32Array> {
  let buf: ArrayBuffer
  try {
    const res = await fetch(url)
    if (!res.ok) return empty
    buf = await res.arrayBuffer()
  } catch {
    return empty
  }
  return downsampleBuf(buf, 1)
}
