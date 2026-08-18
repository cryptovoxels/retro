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
  // ndarray default stride for shape [sx,sy,sz] is [sy*sz, sz, 1] - z fastest
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

  return new Promise((resolve) => {
    VoxReader.read(buf, (vox: any, errstr: string | null) => {
      if (errstr || !vox?.models?.[0]) return resolve(empty)
      const occ = new Uint8Array(16 * 16 * 16)
      vox.models[0].forEach((row: any) => {
        const x = row.x >> 1
        const y = row.y >> 1
        const z = row.z >> 1
        if (x > 15 || y > 15 || z > 15 || x < 0 || y < 0 || z < 0) return
        occ[x + y * 16 + z * 256] = 1
      })
      const out: number[] = []
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 16; y++) {
          for (let z = 0; z < 16; z++) {
            if (!occ[x + y * 16 + z * 256]) continue
            out.push(x - 8, z, 7 - y)
          }
        }
      }
      resolve(out.length ? new Int32Array(out) : empty)
    })
  })
}
