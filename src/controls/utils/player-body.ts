import RAPIER from '@dimforge/rapier3d-compat'
import { physics, PLAYER_QUERY, Vec3 } from '../../physics/world'
const RADIUS = 0.2
const EYE = 1.65 // eye height above the feet
const HEAD = 0.1 // skull above the eyes
const HALF = 0.6
const DROP = (EYE - HEAD) / 2 // eye above the capsule centre, 0.75

const unchanged = (a: Vec3, b: Vec3, epsilon = 0.001) => Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon
const nonzero = (v: Vec3, epsilon = 0.001) => Math.abs(v.x) > epsilon || Math.abs(v.y) > epsilon || Math.abs(v.z) > epsilon

// tuning, metres per second
export const WALK = 2.78 // was defaultSpeed 0.88
export const RUN = 12.65 // was runSpeed 4.0
export const JUMP_SPEED = 6
export const HOP_SPEED = 3
export const GRAVITY = -9.8
export const WALK_HZ = 0.15

export type Motion = { hz: number; vy: number; grounded: boolean; impact: number }

export default class PlayerBody {
  position = BABYLON.Vector3.Zero()
  motion: Motion = { hz: 0, vy: 0, impact: 0 }
  /** vehicles, pose balls, gateway: move straight, skip the world (implies no gravity) */
  noclip = false
  flying = true
  speed = WALK
  private body: RAPIER.RigidBody = undefined!
  private collider: RAPIER.Collider = undefined!
  private controller: RAPIER.KinematicCharacterController = undefined!
  private hit = new RAPIER.CharacterCollision()
  private ready = false
  private vel = new RAPIER.Vector3(0, 0, 0)
  private doubled = true
  private scratch = BABYLON.Vector3.Zero()

  get blocker(): RAPIER.RigidBody | undefined {
    return this.ready ? this.body : undefined
  }

  private setup() {
    if (this.ready) return true
    const w = physics()
    if (!w) return false
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y - DROP, this.position.z))
    this.collider = w.createCollider(RAPIER.ColliderDesc.roundCylinder(HALF, RADIUS, 0.05), this.body)
    this.controller = w.createCharacterController(0.05)
    this.controller.enableAutostep(1, 0.1, false)
    this.controller.setSlideEnabled(true)
    this.controller.setMinSlopeSlideAngle(0.01)
    // this.controller.enableSnapToGround(0.5)
    // this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    this.ready = true
    return true
  }

  jump() {
    // const bump = 0.5
    // const t = this.body.translation()
    // this.body.setTranslation({ x: t.x, y: t.y + bump, z: t.z }, true)
    // this.position.set(t.x, t.y + bump, t.z)

    this.vel.y = JUMP_SPEED
  }

  private writeMotion(hz: number, impact: number) {
    this.motion.hz = hz
    this.motion.vy = this.vel.y
    this.motion.impact = impact
  }

  private stuck = 0

  /** move is unitless direction; speed is m/s; dt is seconds */
  step(move: BABYLON.Vector3, dt: number): void {
    this.scratch.copyFrom(move).scaleInPlace(this.speed * dt)
    const d = this.scratch

    if (this.noclip || !this.setup()) {
      this.position.addInPlace(d)
      this.writeMotion(Math.hypot(d.x, d.z) / dt, 0)
      return
    }

    // teleports and seat snaps move position behind our back: resync before querying
    this.body.setTranslation({ x: this.position.x, y: this.position.y - DROP, z: this.position.z }, true)

    // console.log(this.vel.y)

    let y = d.y

    if (!this.flying) {
      y += this.vel.y * dt
    }

    this.controller.computeColliderMovement(this.collider, { x: d.x, y: y, z: d.z }, undefined, PLAYER_QUERY)
    let stepped = this.controller.computedMovement()
    const at = this.body.translation()
    const next = { x: at.x + stepped.x, y: at.y + stepped.y, z: at.z + stepped.z }

    // Setting velocity
    // this.vel.y = (this.body.translation().y - next.y) / dt

    // console.log(stepped.y)

    const n = this.controller.numComputedCollisions()

    if (n == 0 && !this.flying) {
      this.vel.y += GRAVITY * dt
    } else {
      this.vel.y = 0
    }

    this.body.setNextKinematicTranslation(next)
    this.position.set(next.x, next.y + DROP, next.z)
  }
}
