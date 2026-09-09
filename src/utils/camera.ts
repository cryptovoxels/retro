import PlayerCamera from '../controls/utils/player-camera'
import { EYE } from '../controls/utils/player-body'

const xrHeights = new WeakMap<BABYLON.WebXRCamera, number>()

export function xrHeight(camera: BABYLON.WebXRCamera) {
  // Babylon 6.11.2 reads XRFrame here; the frame is invalid between callbacks.
  if ((camera as any)._xrSessionManager.inXRFrameLoop) {
    try {
      const height = camera.realWorldHeight
      if (height > 0) xrHeights.set(camera, height)
    } catch {}
  }
  return xrHeights.get(camera) ?? EYE
}

export function cameraPosition(scene: BABYLON.Scene): BABYLON.Vector3 {
  if (!scene.activeCamera) return BABYLON.Vector3.Zero()
  if (scene.activeCamera instanceof PlayerCamera) {
    const p = scene.activeCamera.body.position
    return new BABYLON.Vector3(p.x, p.y, p.z)
  }
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) return scene.activeCamera.target
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) return scene.activeCamera.position
  return scene.activeCamera.position
}

export function setCameraPosition(scene: BABYLON.Scene, position: BABYLON.Vector3) {
  if (!scene.activeCamera) return
  if (scene.activeCamera instanceof PlayerCamera) {
    Object.assign(scene.activeCamera.body.position, { x: position.x, y: position.y, z: position.z })
    return
  }
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) {
    scene.activeCamera.target = position
    return
  }
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) {
    const camera = scene.activeCamera
    camera.onBeforeCameraTeleport.notifyObservers(camera.position)
    camera.position.set(position.x, position.y - EYE + xrHeight(camera), position.z)
    camera.onAfterCameraTeleport.notifyObservers(camera.position)
    return
  }
  scene.activeCamera.position = position
}

export function cameraRotation(scene: BABYLON.Scene): BABYLON.Vector3 {
  if (!scene.activeCamera) return BABYLON.Vector3.Zero()
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) return scene.activeCamera.rotationQuaternion.toEulerAngles()
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) return scene.activeCamera.rotation
  if (scene.activeCamera instanceof BABYLON.FreeCamera) return scene.activeCamera.rotation
  return BABYLON.Vector3.Zero()
}

export function setCameraRotation(scene: BABYLON.Scene, rotation: BABYLON.Vector3) {
  if (!scene.activeCamera) return
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) {
    BABYLON.Quaternion.FromEulerAnglesToRef(rotation.x, rotation.y, rotation.z, scene.activeCamera.rotationQuaternion)
    return
  }
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) {
    scene.activeCamera.rotation = rotation
    return
  }
  if (scene.activeCamera instanceof BABYLON.FreeCamera) {
    scene.activeCamera.rotation = rotation
    return
  }
}
