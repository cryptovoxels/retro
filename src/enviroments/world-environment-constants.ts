import { Color3 } from '@babylonjs/lite'
// params are E/W, Altitude, N/S
// the vector is normalised so it's relative positions that matter
export const DAY_SUN_POSITION = (undefined as any /* todo(lite): new BABYLON.Vector3(5, 5, -5).normalize() */)
export const NIGHT_SUN_POSITION = (undefined as any /* todo(lite): new BABYLON.Vector3(3, 0, -5).normalize() */)
export const DAY_BRIGHTNESS = 1.0
export const NIGHT_BRIGHTNESS = 0.2
export const DAY_FOG_COLOR = (undefined as any /* todo(lite): BABYLON.Color3.FromHexString('#90abc0') */)
export const NIGHT_FOG_COLOR = ([0.08, 0.05, 0.05] as Color3)

export const WATER_COLOR = ([0.12, 0.25, 0.45] as Color3)
