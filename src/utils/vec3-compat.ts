import type { Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

export function vecAsArray(v: Vec3): [number, number, number] {
  return [v[0], v[1], v[2]]
}

function vecAxis(v: Vec3, i: 0 | 1 | 2) {
  return {
    get: () => v[i],
    set: (n: number) => {
      v[i] = n
    },
    enumerable: true,
  }
}

export function patchVec3(v: Vec3): Vec3 {
  const a = v as any
  if (a.asArray) return v
  Object.defineProperty(v, 'x', vecAxis(v, 0))
  Object.defineProperty(v, 'y', vecAxis(v, 1))
  Object.defineProperty(v, 'z', vecAxis(v, 2))
  a.asArray = () => vecAsArray(v)
  a.clone = () => patchVec3(vec3.clone(v))
  a.copyFrom = (other: Vec3) => {
    vec3.copy(other, v)
    return v
  }
  a.floor = () => patchVec3(vec3.fromValues(Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2])))
  a.addInPlace = (other: Vec3) => {
    vec3.add(other as any, v, v)
    return v
  }
  a.subtract = (other: Vec3) => {
    const out = vec3.create()
    vec3.subtract(v, other as any, out)
    return patchVec3(out)
  }
  a.subtractFromFloats = (x: number, y: number, z: number) => {
    v[0] -= x
    v[1] -= y
    v[2] -= z
    return v
  }
  a.lengthSquared = () => vec3.lengthSq(v)
  a.set = (x: number, y: number, z: number) => {
    v[0] = x
    v[1] = y
    v[2] = z
    return v
  }
  a.toQuaternion = () => {
    const q = quat.create()
    quat.fromEuler(v[1], v[0], v[2], 'yxz', q)
    return { x: q[0], y: q[1], z: q[2], w: q[3] }
  }
  return v
}
