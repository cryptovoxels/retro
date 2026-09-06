import { parseVox } from '../../common/vox/parse'

const empty = new Int32Array(0)

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

function downsampleBuf(buf: ArrayBuffer, shift: number): Int32Array {
  try {
    const vox = parseVox(buf)
    const size = vox.sizes[0]
    const { gx, gy, gz } = gridDims(size, shift)
    const occ = new Uint8Array(gx * gy * gz)
    const at = (x: number, y: number, z: number) => x + y * gx + z * gx * gy
    for (const row of vox.models[0]) {
      const x = row.x >> shift
      const y = row.y >> shift
      const z = row.z >> shift
      if (x < 0 || y < 0 || z < 0 || x >= gx || y >= gy || z >= gz) continue
      occ[at(x, y, z)] = 1
    }
    const out: number[] = []
    for (let x = 0; x < gx; x++) {
      for (let y = 0; y < gy; y++) {
        for (let z = 0; z < gz; z++) {
          if (!occ[at(x, y, z)]) continue
          out.push(...localCoord(x, y, z, gx, gy, gz))
        }
      }
    }
    return out.length ? new Int32Array(out) : empty
  } catch {
    return empty
  }
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

export { voxelCollider } from '../../common/vox/collider'
