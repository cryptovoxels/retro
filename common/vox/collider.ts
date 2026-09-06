import type { NdArray } from 'ndarray'

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
