import PlayerCamera from './player-camera'
import { coords } from '../../../common/helpers/utils'

export function createFirstPersonCamera(scene: BABYLON.Scene, coords: coords): PlayerCamera {
  const camera = new PlayerCamera('player-camera', coords?.position || BABYLON.Vector3.Zero(), scene)

  camera.minZ = 0.1
  camera.maxZ = window.draw.distance * 2.0

  window.draw.addEventListener('distance-changed', (e) => {
    camera.maxZ = e.detail * 2.0
  })

  camera.checkCollisions = false
  camera.ellipsoid = new BABYLON.Vector3(0.25, 0.85, 0.25)

  // we default to no gravity and enable it once world has loaded
  camera.applyGravity = false

  // field of view
  camera.fov = window.fov.value
  window.fov.addEventListener(
    'changed',
    (e) => {
      camera.fov = e.detail.value
    },
    { passive: true },
  )

  // Inertia is gross with pointerlock
  camera.inertia = 0

  // sensitivity
  camera.angularSensibility = window.cameraSettings.angularSensitivity
  window.cameraSettings.addEventListener(
    'sensitivity-changed',
    (e) => {
      camera.angularSensibility = e.detail.value
    },
    { passive: true },
  )

  return camera
}
