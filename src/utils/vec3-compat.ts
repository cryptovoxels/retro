import type { Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

export function vecAsArray(v: Vec3): [number, number, number] {
  const a = v as any
  const x = a[0] ?? a.x ?? 0
  const y = a[1] ?? a.y ?? 0
  const z = a[2] ?? a.z ?? 0
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0]
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
  a.toArray = (dst?: ArrayLike<number> | null, offset = 0) => {
    const out = (dst ?? new Float32Array(3)) as any
    out[offset] = v[0]
    out[offset + 1] = v[1]
    out[offset + 2] = v[2]
    return out
  }
  a.clone = () => patchVec3(vec3.clone(v))
  a.copyFrom = (other: Vec3) => {
    const o = other as any
    v[0] = o[0] ?? o.x ?? 0
    v[1] = o[1] ?? o.y ?? 0
    v[2] = o[2] ?? o.z ?? 0
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
  a.setAll = (n: number) => {
    v[0] = v[1] = v[2] = n
    return v
  }
  a.copyFromFloats = (x: number, y: number, z: number) => {
    v[0] = x
    v[1] = y
    v[2] = z
    return v
  }
  a.addInPlaceFromFloats = (x: number, y: number, z: number) => {
    v[0] += x
    v[1] += y
    v[2] += z
    return v
  }
  a.toQuaternion = () => {
    const q = quat.create()
    quat.fromEuler(v[1], v[0], v[2], 'yxz', q)
    return { x: q[0], y: q[1], z: q[2], w: q[3] }
  }
  return v
}
