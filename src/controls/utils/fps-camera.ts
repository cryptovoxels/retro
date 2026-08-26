import PlayerCamera from './player-camera'
import { coords } from '../../../common/helpers/utils'
import { SceneContext } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'

export function createFirstPersonCamera(scene: SceneContext, coords: coords): PlayerCamera {
  const camera = new PlayerCamera('player-camera', coords?.position || vec3.create(), scene)

  camera.minZ = 0.1
  camera.maxZ = window.draw.distance * 2.0

  window.draw.addEventListener('distance-changed', (e) => {
    camera.maxZ = e.detail * 2.0
  })

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

  // nothing reads camera.speed for walk now; set so stock gamepad input's
  // cameraDirection comes back as raw stick deflection * dt
  // (babylon: speed * sqrt(10) * dt * 50)
  camera.speed = 1 / (50 * Math.sqrt(10))

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
