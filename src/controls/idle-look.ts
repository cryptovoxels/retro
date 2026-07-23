import type Controls from './controls'
import OurCamera from './utils/our-camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'

const DEG = Math.PI / 180
const BOB_SPEED = 0.7
const POS = 0.04
const ROLL = 1.5 * DEG
const LOOK = 1
const BLEND = 0.5

function smooth(t: number) {
  // smootherstep — no flat spots, no linear mush
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function aim(from: BABYLON.Vector3, to: BABYLON.Vector3) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const horiz = Math.sqrt(dx * dx + dz * dz)
  return {
    yaw: Math.atan2(dx, dz),
    pitch: -Math.atan2(dy, horiz || 1e-6),
  }
}

export class IdleLook {
  private controls: Controls
  private live = false
  private goal = 0
  private amount = 0
  private bobT = 0
  private home = new BABYLON.Vector3()
  private target = new BABYLON.Vector3()
  private right = new BABYLON.Vector3()
  private up = new BABYLON.Vector3()
  private scratch = new BABYLON.Vector3()

  constructor(controls: Controls, _scene: BABYLON.Scene) {
    this.controls = controls
  }

  get active() {
    return this.live || this.amount > 0
  }

  start() {
    if (hasPointerLock()) return
    const cam = this.controls.camera
    if (!(cam instanceof OurCamera)) return

    // capture rest pose from wherever the cam is now
    this.home.copyFrom(cam.position)
    this.right.copyFrom(cam.getDirection(BABYLON.Axis.X))
    this.up.copyFrom(cam.getDirection(BABYLON.Axis.Y))
    this.scratch.copyFrom(cam.getDirection(BABYLON.Axis.Z))
    this.target.copyFrom(this.home).addInPlace(this.scratch.scaleInPlace(LOOK))
    this.bobT = 0
    this.live = true
    this.goal = 1
  }

  stop() {
    if (!this.live && this.amount <= 0) return
    this.live = false
    this.goal = 0
  }

  /** hard cut — used when mouselook grabs the cam */
  abort() {
    this.live = false
    this.goal = 0
    this.amount = 0
    this.apply(0)
  }

  tick(dt: number) {
    const cam = this.controls.camera
    if (!(cam instanceof OurCamera)) {
      this.abort()
      return
    }

    // mouselook owns the camera — get out of the way
    if (hasPointerLock()) {
      if (this.active) this.abort()
      return
    }

    const moving = this.controls.jumping || cam.cameraDirection.lengthSquared() > 1e-6
    if (moving && this.live) this.stop()

    if (this.amount < this.goal) {
      this.amount = Math.min(1, this.amount + dt / BLEND)
    } else if (this.amount > this.goal) {
      this.amount = Math.max(0, this.amount - dt / BLEND)
    }

    const w = smooth(this.amount)

    if (this.amount <= 0 && this.goal <= 0) {
      cam.rotationQuaternion = null as any
      cam.rotation.z = 0
      this.live = false
      return
    }

    this.bobT += dt * BOB_SPEED

    // walking: free the body, just fade roll out so we don't eat WASD
    if (moving && this.goal === 0) {
      cam.rotationQuaternion = null as any
      cam.rotation.z = Math.sin(this.bobT) * ROLL * w
      return
    }

    this.apply(w)
  }

  private apply(w: number) {
    const cam = this.controls.camera
    if (!(cam instanceof OurCamera)) return

    const sx = Math.sin(this.bobT) * POS * w
    const sy = Math.sin(this.bobT * 2) * POS * w

    cam.position.copyFrom(this.home)
    this.scratch.copyFrom(this.right).scaleInPlace(sx)
    cam.position.addInPlace(this.scratch)
    this.scratch.copyFrom(this.up).scaleInPlace(sy)
    cam.position.addInPlace(this.scratch)

    const a = aim(cam.position, this.target)
    cam.rotationQuaternion = null as any
    cam.rotation.x = a.pitch
    cam.rotation.y = a.yaw
    cam.rotation.z = Math.sin(this.bobT) * ROLL * w
  }
}
