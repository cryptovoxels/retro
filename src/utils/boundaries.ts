import { Vec3 } from '@babylonjs/lite'
interface DistanceOptions {
  yMultiplier?: number
}

// be very sure that the point and that Axis-Aligned BoundingBox (AABB) is working in the same coordinate space
export function distanceToAABB(point: Vec3, AABB: any, options?: DistanceOptions) {
  return Math.sqrt(sqrDistanceToAABB(point, AABB, options))
}

// slight faster version due to the lack of Math.sqrt, still usable for comparison between points and a list of boxes
export function sqrDistanceToAABB(point: Vec3, boundingbox: any, options?: DistanceOptions) {
  const yMultiplier = options && options.yMultiplier ? options.yMultiplier : 1.0
  const dx = Math.max(boundingbox.minimum.x - point.x, 0, point.x - boundingbox.maximum.x)
  const dy = Math.max(boundingbox.minimum.y - point.y, 0, point.y - boundingbox.maximum.y) * yMultiplier
  const dz = Math.max(boundingbox.minimum.z - point.z, 0, point.z - boundingbox.maximum.z)
  return dx * dx + dy * dy + dz * dz
}
