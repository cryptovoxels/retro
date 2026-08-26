import PlayerCamera from '../controls/utils/player-camera'
import { SceneContext, Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

export function cameraPosition(scene: SceneContext): Vec3 {
  if (!scene.activeCamera) return vec3.create()
  if (scene.activeCamera instanceof PlayerCamera) return scene.activeCamera.body.position
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) return scene.activeCamera.target
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) return scene.activeCamera.position
  return scene.activeCamera.position
}

export function setCameraPosition(scene: SceneContext, position: Vec3) {
  if (!scene.activeCamera) return
  if (scene.activeCamera instanceof PlayerCamera) {
    scene.activeCamera.body.position.copyFrom(position)
    return
  }
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
  if (!scene.activeCamera) return vec3.create()
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.ArcRotateCamera */)) return scene.activeCamera.rotation
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.FreeCamera */)) return scene.activeCamera.rotation
  if ((false /* todo(lite): scene.activeCamera instanceof BABYLON.WebXRCamera */)) return scene.activeCamera.rotationQuaternion.toEulerAngles()
  return vec3.create()
}

export function setCameraRotation(scene: SceneContext, rotation: Vec3) {
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
    scene.activeCamera.rotationQuaternion = quat.fromEuler(rotation.x, rotation.y, rotation.z, 'yxz') /* todo(lite): verify euler order */
  }
}
