import PlayerCamera from '../controls/utils/player-camera'
import { FreeCamera, SceneContext, Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'
import { patchVec3 } from './vec3-compat'

function playerCamera() {
  return (window as any).controls?.camera as PlayerCamera | undefined
}

function bjsVec(v: Vec3) {
  return {
    get x() {
      return v[0]
    },
    get y() {
      return v[1]
    },
    get z() {
      return v[2]
    },
    add(other: { x: number; y: number; z: number }) {
      v[0] += other.x
      v[1] += other.y
      v[2] += other.z
      return this
    },
    multiplyByFloats(sx: number, sy: number, sz: number) {
      return bjsVec(vec3.fromValues(v[0] * sx, v[1] * sy, v[2] * sz))
    },
    clone() {
      return bjsVec(vec3.clone(v))
    },
  }
}

export function cameraForwardRay(cam: FreeCamera, length = 1) {
  const origin = vec3.clone(cam.position as any)
  const direction = vec3.create()
  vec3.subtract(cam.target as any, cam.position as any, direction)
  vec3.normalize(direction, direction)
  if (length !== 1) vec3.scale(length, direction, direction)
  return { origin: bjsVec(origin), direction: bjsVec(direction) }
}

export function attachForwardRay(cam: FreeCamera) {
  ;(cam as any).getForwardRay = (length = 1) => cameraForwardRay(cam, length)
}

export function cameraPosition(scene: SceneContext): Vec3 {
  const cam = playerCamera()
  if (cam) return patchVec3(cam.body.position as any)
  if (!scene.activeCamera) return patchVec3(vec3.create())
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) return patchVec3(scene.activeCamera.target as any)
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) return patchVec3(scene.activeCamera.position as any)
  return patchVec3(scene.activeCamera.position as any)
}

export function setCameraPosition(scene: SceneContext, position: Vec3) {
  const cam = playerCamera()
  if (cam) {
    cam.body.position.copyFrom(position as any)
    return
  }
  if (!scene.activeCamera) return
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) {
    scene.activeCamera.target = position
    return
  }
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) {
    scene.activeCamera.position = position
    return
  }
  scene.activeCamera.position = position
}

export function cameraRotation(scene: SceneContext): Vec3 {
  const cam = playerCamera()
  if (cam) {
    const r = cam.rotation
    return patchVec3(vec3.fromValues(r.x, r.y, r.z))
  }
  if (!scene.activeCamera) return patchVec3(vec3.create())
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) return patchVec3(scene.activeCamera.rotation as any)
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.FreeCamera */)) return patchVec3(scene.activeCamera.rotation as any)
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) return patchVec3(scene.activeCamera.rotationQuaternion.toEulerAngles() as any)
  return patchVec3(vec3.create())
}

export function setCameraRotation(scene: SceneContext, rotation: Vec3) {
  const cam = playerCamera()
  if (cam) {
    cam.rotation.x = rotation[0]
    cam.rotation.y = rotation[1]
    cam.rotation.z = rotation[2]
    return
  }
  if (!scene.activeCamera) return
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) {
    scene.activeCamera.rotation = rotation
    return
  }
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.FreeCamera */)) {
    scene.activeCamera.rotation = rotation
    return
  }
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) {
    scene.activeCamera.rotationQuaternion = quat.fromEuler(rotation[1], rotation[0], rotation[2], 'yxz')
  }
}
