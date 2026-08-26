export type Vec3 = { x: number; y: number; z: number }

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function aabbDistance(p: Vec3, min: Vec3, max: Vec3): number {
  const x = Math.max(min.x, Math.min(max.x, p.x))
  const y = Math.max(min.y, Math.min(max.y, p.y))
  const z = Math.max(min.z, Math.min(max.z, p.z))
  const dx = p.x - x
  const dy = p.y - y
  const dz = p.z - z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
