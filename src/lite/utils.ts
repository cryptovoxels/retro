import type { Texture2D } from '@babylonjs/lite'
import type { Lite } from './index'

// todo: textures are never released, the cache is bounded by unique urls visited
const textures = new Map<string, Promise<Texture2D | null>>()

export function loadTex(lite: Lite, url: string) {
  let p = textures.get(url)
  if (!p) {
    p = lite.L.loadTexture2D(lite.engine, url).catch(() => null)
    textures.set(url, p)
  }
  return p
}

// babylon's Quaternion.RotationYawPitchRoll(y, x, z). lite's eulerToQuat is intrinsic XYZ, wrong order for feature rotations
export function quatYXZ(x: number, y: number, z: number): [number, number, number, number] {
  const sr = Math.sin(z / 2)
  const cr = Math.cos(z / 2)
  const sp = Math.sin(x / 2)
  const cp = Math.cos(x / 2)
  const sy = Math.sin(y / 2)
  const cy = Math.cos(y / 2)
  return [cy * sp * cr + sy * cp * sr, sy * cp * cr - cy * sp * sr, cy * cp * sr - sy * sp * cr, cy * cp * cr + sy * sp * sr]
}

// feature records store vectors as [x,y,z] or {x,y,z}, sometimes with holes
export function vec(v: any): [number, number, number] {
  if (Array.isArray(v)) return [v[0] || 0, v[1] || 0, v[2] || 0]
  return v ? [v.x || 0, v.y || 0, v.z || 0] : [0, 0, 0]
}

export const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]
