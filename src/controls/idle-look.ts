import type Controls from './controls'
import PlayerCamera from './utils/player-camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'

const DEG = Math.PI / 180
const BOB_SPEED = 0.7
const POS = 0.04
const ANG = 1.5 * DEG
const BLEND = 0.5 // mix 0->1 over 500ms

export class IdleLook {
  private controls: Controls
  private live = false
  private goal = 0
  private mix = 0
  private bobT = 0
  private pos = new BABYLON.Vector3()
  private rot = new BABYLON.Vector3()
  private scratch = new BABYLON.Vector3()

  constructor(controls: Controls, _scene: BABYLON.Scene) {
    this.controls = controls
  }

  get active() {
    return this.live || this.mix > 0
  }

  start() {
    if (hasPointerLock()) return
    const cam = this.controls.camera
    if (!(cam instanceof PlayerCamera)) return
    this.bobT = 0
    this.live = true
    this.goal = 1
  }

  stop() {
    if (!this.live && this.mix <= 0) return
    this.live = false
    this.goal = 0
  }

  /** hard cut — used when mouselook grabs the cam */
  abort() {
    this.live = false
    this.goal = 0
    this.mix = 0
    const cam = this.controls.camera
    if (cam instanceof PlayerCamera) cam.clearIdle()
  }

  tick(dt: number) {
    const cam = this.controls.camera
    if (!(cam instanceof PlayerCamera)) {
      this.abort()
      return
    }

    if (hasPointerLock()) {
      if (this.active) this.abort()
      return
    }

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

    // positional bob (sin) in local right/up
    const sx = Math.sin(this.bobT) * POS
    const sy = Math.sin(this.bobT * 2) * POS
    this.pos.copyFrom(cam.getDirection(BABYLON.Axis.X)).scaleInPlace(sx)
    this.scratch.copyFrom(cam.getDirection(BABYLON.Axis.Y)).scaleInPlace(sy)
    this.pos.addInPlace(this.scratch)

    // rotational bob (cos) — counters the sway a bit
    this.rot.set(Math.cos(this.bobT) * ANG, Math.cos(this.bobT * 0.5) * ANG, Math.cos(this.bobT) * ANG)

    cam.applyIdle(this.pos, this.rot, this.mix)
  }
}
