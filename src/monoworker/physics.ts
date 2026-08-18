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

/** Deduped point cloud from a .vox url for ColliderDesc.convexHull. */
export async function hullPoints(url: string): Promise<Float32Array> {
  const { loadVox } = await import('./vox')
  const data = await loadVox({
    renderJob: Date.now(),
    url,
    flipX: false,
    megavox: false,
    maxTriangles: 0,
    dryRun: false,
    wantCollider: false,
    timeoutMs: 30000,
  } as any)
  if (!data?.positions) return new Float32Array(0)

  const positions: Float32Array = data.positions
  const seen = new Set<string>()
  const pts: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.round(positions[i] * 10)},${Math.round(positions[i + 1] * 10)},${Math.round(positions[i + 2] * 10)}`
    if (seen.has(key)) continue
    seen.add(key)
    pts.push(positions[i], positions[i + 1], positions[i + 2])
  }
  return new Float32Array(pts)
}
