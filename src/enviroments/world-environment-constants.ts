import { Color3, Vec3 } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'

function normSun(x: number, y: number, z: number): Vec3 {
  const v = vec3.fromValues(x, y, z)
  vec3.normalize(v, v)
  return v as Vec3
}

// params are E/W, Altitude, N/S - normalised direction only matters
export const DAY_SUN_POSITION = normSun(5, 5, -5)
export const NIGHT_SUN_POSITION = normSun(3, 0, -5)
export const DAY_BRIGHTNESS = 1.0
export const NIGHT_BRIGHTNESS = 0.2
export const DAY_FOG_COLOR = ([144 / 255, 171 / 255, 192 / 255] as Color3) // #90abc0
export const NIGHT_FOG_COLOR = ([0.08, 0.05, 0.05] as Color3)

export const WATER_COLOR = ([0.12, 0.25, 0.45] as Color3)
