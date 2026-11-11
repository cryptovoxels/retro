import type { Pose } from '../../common/messages/feature'
import { AnimationYOffset } from '../avatar-animations'
import { cameraPosition, setCameraPosition, setCameraRotation } from '../utils/camera'
import type Feature from './feature'

let occupied: { feature: Feature; leave: () => void } | undefined

export const seated = (f: Feature) => occupied?.feature === f

export function leaveSeat(f: Feature) {
  if (seated(f)) occupied?.leave()
}

export function takePose(f: Feature, pose: Pose) {
  const avatar = window.persona?.avatar
  const controls = window.connector?.controls
  if (!avatar || !controls || !f.mesh) return
  const toggle = seated(f)
  occupied?.leave()
  if (toggle) return
  f.mesh.computeWorldMatrix(true)
  const rotation = f.mesh.absoluteRotationQuaternion.toEulerAngles()
  const yaw = rotation.y
  const [x, y, z] = pose.offset ?? [0, 0, 0]
  const position = f.mesh.absolutePosition.clone()
  position.x += x * Math.cos(yaw) + z * Math.sin(yaw)
  position.z += z * Math.cos(yaw) - x * Math.sin(yaw)
  position.y += y + avatar.height + AnimationYOffset(pose.animation)
  const noclip = controls.body.noclip
  controls.setNoclip(true)
  rotation.set(0, yaw + (pose.yaw || 0), 0)
  setCameraRotation(f.scene, rotation)
  setCameraPosition(f.scene, position)
  window.persona.playEmote(pose.animation)
  const observer = f.scene.onAfterRenderObservable.add(() => {
    if (BABYLON.Vector3.DistanceSquared(cameraPosition(f.scene), position) > 0.16) leaveSeat(f)
  })
  occupied = {
    feature: f,
    leave: () => {
      occupied = undefined
      f.scene.onAfterRenderObservable.remove(observer)
      window.persona.playEmote(null)
      controls.setNoclip(noclip)
    },
  }
}
