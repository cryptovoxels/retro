import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'
import { VoxelSize } from '../../../common/voxels/constants'

const RADIUS = 0.2
const EYE = 1.6 // eye height above the feet
const HEAD = 0.1 // skull above the eyes
const HALF = 0.6
const DROP = (EYE - HEAD) / 2 // eye above the capsule centre, 0.75
const BURIED = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS

// tuning, metres per second
export const WALK = 2.78 // was defaultSpeed 0.88
export const RUN = 12.65 // was runSpeed 4.0
export const JUMP_SPEED = 6
export const HOP_SPEED = 3
export const GRAVITY = -10.8
export const WALK_HZ = 0.15

export type Motion = { hz: number; vy: number; grounded: boolean; impact: number }

export default class PlayerBody {
  position = BABYLON.Vector3.Zero()
  grounded = false
  motion: Motion = { hz: 0, vy: 0, grounded: false, impact: 0 }
  /** vehicles, pose balls, gateway: move straight, skip the world (implies no gravity) */
  noclip = false
  gravity = false
  speed = WALK
  private body: RAPIER.RigidBody = undefined!
  private collider: RAPIER.Collider = undefined!
  private controller: RAPIER.KinematicCharacterController = undefined!
  private hit = new RAPIER.CharacterCollision()
  private ready = false
  private vel = 0
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
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), this.body)
    this.controller = w.createCharacterController(0.02)
    // this.controller.enableAutostep(0.2, 0.3, false)
    // this.controller.enableSnapToGround(0.1)
    // this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    this.ready = true
    return true
  }

  jump() {
    if (this.grounded || this.vel === 0) {
      this.vel = JUMP_SPEED
      this.grounded = false
      return
    }
    if (this.doubled) {
      this.doubled = false
      this.vel = JUMP_SPEED
    }
  }

  hop() {
    this.vel = HOP_SPEED
    this.grounded = false
  }

  private writeMotion(hz: number, impact: number) {
    this.motion.hz = hz
    this.motion.vy = this.vel
    this.motion.grounded = this.grounded
    this.motion.impact = impact
  }

  /** move is unitless direction; speed is m/s; dt is seconds */
  step(move: BABYLON.Vector3, dt: number): void {
    this.scratch.copyFrom(move).scaleInPlace(this.speed * dt)
    const d = this.scratch

    if (this.noclip || !this.setup()) {
      this.position.addInPlace(d)
      this.grounded = false
      this.writeMotion(Math.hypot(d.x, d.z) / dt, 0)
      return
    }

    // teleports and seat snaps move position behind our back: resync before querying
    this.body.setTranslation({ x: this.position.x, y: this.position.y - DROP, z: this.position.z }, true)

    if (this.gravity) this.vel += GRAVITY * dt
    else if (this.vel > 0) {
      this.vel += GRAVITY * dt
      if (this.vel < 0) this.vel = 0
    } else {
      this.vel = 0
    }

    const dy = this.gravity ? this.vel * dt : d.y + this.vel * dt
    this.controller.computeColliderMovement(this.collider, { x: d.x, y: dy, z: d.z })
    let stepped = this.controller.computedMovement()
    const at = this.body.translation()
    const next = { x: at.x + stepped.x, y: at.y + stepped.y, z: at.z + stepped.z }
    this.body.setNextKinematicTranslation(next)
    this.position.set(next.x, next.y + DROP, next.z)

    const wasGrounded = this.grounded
    this.grounded = !!this.controller.computedGrounded()
    let floorHit = false
    const n = this.controller.numComputedCollisions()
    for (let i = 0; i < n; i++) {
      const c = this.controller.computedCollision(i, this.hit)
      if (c && c.normal1.y > 0.5) {
        floorHit = true
        break
      }
    }
    const impact = !wasGrounded && floorHit && this.vel < 0 ? -this.vel : 0
    this.writeMotion(Math.hypot(stepped.x, stepped.z) / dt, impact)
    if (this.grounded && this.vel <= 0) {
      this.vel = 0
      this.doubled = true
    }
  }
}
