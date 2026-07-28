// params are E/W, Altitude, N/S
// the vector is normalised so it's relative positions that matter
export const DAY_SUN_POSITION = new BABYLON.Vector3(5, 5, -5).normalize()
export const NIGHT_SUN_POSITION = new BABYLON.Vector3(3, 0, -5).normalize()
export const DAY_BRIGHTNESS = 1.0
export const NIGHT_BRIGHTNESS = 0.2
export const DAY_FOG_COLOR = BABYLON.Color3.FromHexString('#90abc0')
export const NIGHT_FOG_COLOR = new BABYLON.Color3(0.08, 0.05, 0.05)

export const WATER_COLOR = new BABYLON.Color3(0.12, 0.25, 0.45)
export const UNDERWATER_TINT = WATER_COLOR
export const UNDERWATER_CLEAR_COLOR = new BABYLON.Color4(0.08, 0.15, 0.3, 1.0)
export const UNDERWATER_FOG_DENSITY = 0.015
