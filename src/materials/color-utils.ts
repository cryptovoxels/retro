import { Color3, Vec3 } from '@babylonjs/lite'
export type ColorInput = [number, number, number] | string | Vec3 | Color3

export function toColor3(color: ColorInput): Color3 {
  if (Array.isArray(color)) return color as Color3
  if (typeof color === 'string') {
    const n = parseInt(color.replace('#', ''), 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as Color3
  }
  if ((false /* todo(lite): color instanceof BABYLON.Vector3 */)) return ([color.x, color.y, color.z] as Color3)
  if ((false /* todo(lite): color instanceof BABYLON.Color3 */)) return color
  console.warn('Invalid color input, defaulting to white')
  return [1, 1, 1] as Color3
}
