import type Controls from './controls'
import PlayerCamera from './utils/player-camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'

const ENABLED = false // todo: re-enable when neck bob feels right

const BOB_SPEED = 0.7
const BLEND = 0.5 // mix 0->1 over 500ms
const LOOK_DIST = 20

// ghetto neck IK: figure-8 on top of 30cm sphere, roll from the lean
function neck(t: number) {
  const RADIUS = 1.2 // sphere radius, meters (30cm)
  const X_SWING = 0.1 // max left/right swing (meters)
  const Z_SWING = 0.3 // max forward/back swing (meters)
  const X_FREQ = 0.9 // x-axis oscillation frequency
  const Z_FREQ = 0.8 // z-axis oscillation frequency (double x for figure-8)
  const SPHERE_SQ = RADIUS * RADIUS // R^2 for sqrt
  const ROLL_OFFSET = RADIUS // offset for atan2 to lean from center

  const x = Math.sin(t * X_FREQ) * X_SWING
  const z = Math.sin(t * Z_FREQ) * Z_SWING
  const y = Math.sqrt(SPHERE_SQ - x * x - z * z) - RADIUS
  const roll = Math.atan2(x, ROLL_OFFSET + y)
  return { x, y, z, roll }
}

export class IdleLook {
  private controls: Controls
  private live = false
  private goal = 0
  private mix = 0
  private bobT = 0
  private target = new BABYLON.Vector3()
  private pos = new BABYLON.Vector3()
  private look = BABYLON.Quaternion.Identity()
  private scratch = new BABYLON.Vector3()

  constructor(controls: Controls, _scene: BABYLON.Scene) {
    this.controls = controls
  }

  get active() {
    return ENABLED && (this.live || this.mix > 0)
  }

  start() {
    if (!ENABLED) return
    if (hasPointerLock()) return
    const cam = this.controls.camera
    if (!(cam instanceof PlayerCamera)) return

    cam.clearIdle()

    // one ray on enter — bob keeps this point center-screen via look quat
    const ray = cam.getForwardRay(LOOK_DIST)
    const hit = cam.getScene().pickWithRay(ray)
    if (hit?.hit && hit.pickedPoint) {
      this.target.copyFrom(hit.pickedPoint)
    } else {
      this.target.copyFrom(ray.origin).addInPlace(this.scratch.copyFrom(ray.direction).scaleInPlace(LOOK_DIST))
    }

    this.bobT = 0
    this.live = true
    this.goal = 1
  }

  stop() {
    if (!this.live && this.mix <= 0) return
    this.live = false
    this.goal = 0
  }

  /** hard cut — bake out, no lerp */
  abort() {
    this.live = false
    this.goal = 0
    this.mix = 0
    const cam = this.controls.camera
    if (cam instanceof PlayerCamera) cam.clearIdle()
  }

  tick(dt: number) {
    if (!ENABLED) return
    const cam = this.controls.camera
    if (!(cam instanceof PlayerCamera)) {
      this.abort()
      return
    }

    // lock: lerp out, don't snap. keep ticking until mix hits 0
    if (hasPointerLock() && this.live) this.stop()

    const moving = this.controls.jumping || cam.cameraDirection.lengthSquared() > 1e-6
    if (moving && this.live) this.stop()

    if (this.mix < this.goal) {
      this.mix = Math.min(1, this.mix + dt / BLEND)
    } else if (this.mix > this.goal) {
      this.mix = Math.max(0, this.mix - dt / BLEND)
    }

    if (this.mix <= 0 && this.goal <= 0) {
      cam.clearIdle()
      this.live = false
      return
    }

    this.bobT += dt * BOB_SPEED

    // undo previous idle so bob is from true pose
    cam.clearIdle()

    const n = neck(this.bobT)
    this.pos.copyFrom(cam.getDirection(BABYLON.Axis.X)).scaleInPlace(n.x)
    this.scratch.copyFrom(cam.getDirection(BABYLON.Axis.Y)).scaleInPlace(n.y)
    this.pos.addInPlace(this.scratch)
    this.scratch.copyFrom(cam.getDirection(BABYLON.Axis.Z)).scaleInPlace(n.z)
    this.pos.addInPlace(this.scratch)

    // look quat from bobbed eye -> frozen target, keep neck roll
    this.scratch.copyFrom(cam.position).addInPlace(this.pos)
    const dx = this.target.x - this.scratch.x
    const dy = this.target.y - this.scratch.y
    const dz = this.target.z - this.scratch.z
    const horiz = Math.sqrt(dx * dx + dz * dz)
    const pitch = -Math.atan2(dy, horiz || 1e-6)
    const yaw = Math.atan2(dx, dz)
    BABYLON.Quaternion.FromEulerAnglesToRef(pitch, yaw, n.roll, this.look)

    cam.applyIdle(this.pos, this.look, this.mix)
  }
}
