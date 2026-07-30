import { vec3, type Mat4, type Vec3Arg } from 'wgpu-matrix'
import { Bounds } from './bounds'

/**
 * Compute a conservative axis-aligned bounding box by transforming
 * the 8 corners of a local box [minCorner, maxCorner].
 */
export function computeAabb(matrix: Mat4, minCorner: Vec3Arg, maxCorner: Vec3Arg): Bounds {
  const minV = vec3.fromValues(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const maxV = vec3.fromValues(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  const corner = vec3.create(0, 0, 0)
  const transformed = vec3.create(0, 0, 0)

  for (const x of [minCorner[0], maxCorner[0]]) {
    for (const y of [minCorner[1], maxCorner[1]]) {
      for (const z of [minCorner[2], maxCorner[2]]) {
        vec3.set(x, y, z, corner)
        vec3.transformMat4(corner, matrix, transformed)
        vec3.min(minV, transformed, minV)
        vec3.max(maxV, transformed, maxV)
      }
    }
  }

  return new Bounds(minV, maxV)
}
