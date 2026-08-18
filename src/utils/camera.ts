import PlayerCamera from '../controls/utils/player-camera'

export function cameraPosition(scene: BABYLON.Scene): BABYLON.Vector3 {
  if (!scene.activeCamera) return BABYLON.Vector3.Zero()
  if (scene.activeCamera instanceof PlayerCamera) return scene.activeCamera.player
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) return scene.activeCamera.target
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) {
    const offset = window.environment ? window.environment.parent.position : BABYLON.Vector3.Zero()
    return scene.activeCamera.position.subtract(offset)
  }
  return scene.activeCamera.position
}

export function setCameraPosition(scene: BABYLON.Scene, position: BABYLON.Vector3) {
  if (!scene.activeCamera) return
  if (scene.activeCamera instanceof PlayerCamera) {
    scene.activeCamera.player.copyFrom(position)
    return
  }
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) {
    scene.activeCamera.target = position
    return
  }
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) {
    const offset = window.environment ? window.environment.parent.position : BABYLON.Vector3.Zero()
    scene.activeCamera.position = position.add(offset)
    return
  }
  scene.activeCamera.position = position
}

export function cameraRotation(scene: BABYLON.Scene): BABYLON.Vector3 {
  if (!scene.activeCamera) return BABYLON.Vector3.Zero()
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) return scene.activeCamera.rotation
  if (scene.activeCamera instanceof BABYLON.FreeCamera) return scene.activeCamera.rotation
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) return scene.activeCamera.rotationQuaternion.toEulerAngles()
  return BABYLON.Vector3.Zero()
}

export function setCameraRotation(scene: BABYLON.Scene, rotation: BABYLON.Vector3) {
  if (!scene.activeCamera) return
  if (scene.activeCamera instanceof BABYLON.ArcRotateCamera) {
    scene.activeCamera.rotation = rotation
    return
  }
  if (scene.activeCamera instanceof BABYLON.FreeCamera) {
    scene.activeCamera.rotation = rotation
    return
  }
  if (scene.activeCamera instanceof BABYLON.WebXRCamera) {
    scene.activeCamera.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z)
  }
}
