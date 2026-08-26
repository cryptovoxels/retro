import { Color3, Vec3 } from '@babylonjs/lite'
export type ColorInput = [number, number, number] | string | Vec3 | Color3

export function toColor3(color: ColorInput): Color3 {
  if (Array.isArray(color)) return (undefined as any /* todo(lite): BABYLON.Color3.FromArray(color) */)
  if (typeof color === 'string') return (undefined as any /* todo(lite): BABYLON.Color3.FromHexString(color) */)
  if ((false /* todo(lite): color instanceof BABYLON.Vector3 */)) return ([color.x, color.y, color.z] as Color3)
  if ((false /* todo(lite): color instanceof BABYLON.Color3 */)) return color
  // Fallback to white if input is invalid
  console.warn('Invalid color input, defaulting to white')
  return ([1, 1, 1] as Color3)
}
