import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'
import { VoxelSize } from '../../../common/voxels/constants'

const RADIUS = 0.25
const EYE = 1.6 // eye height above the feet
const HEAD = 0.1 // skull above the eyes
const HALF = (EYE + HEAD) / 2 - RADIUS // capsule half height, 0.6
const DROP = (EYE - HEAD) / 2 // eye above the capsule centre, 0.75
const JUMP_SPEED = 6
const HOP_SPEED = 3
const GRAVITY = -10.8
const ORBIT_MARGIN = 0.3 // keep the lens off the wall it just hit
export const WALK_HZ = 0.15

export type Motion = { hz: number; vy: number; grounded: boolean; impact: number }

// FreeCamera owns the look direction, rapier owns where the body can go.
// Hook _updatePosition, not _collideWithWorld: babylon gates the latter behind
// checkCollisions + scene.collisionsEnabled, and both are gone.
export default class PlayerCamera extends BABYLON.FreeCamera {
  /** the body. `position` is where we render from, which in third person is not the same thing. */
  player = BABYLON.Vector3.Zero()
  /** metres behind the eye; Controls eases this */
  distance = 0
  grounded = false
  motion: Motion = { hz: 0, vy: 0, grounded: false, impact: 0 }
  /** vehicles, pose balls, gateway: move the player straight, skip the world (implies no gravity) */
  noclip = false
  gravity = false
  private body: RAPIER.RigidBody = undefined!
  private collider: RAPIER.Collider = undefined!
  private controller: RAPIER.KinematicCharacterController = undefined!
  private hit = new RAPIER.CharacterCollision()
  private ready = false
  private vel = 0
  private doubled = true
  private back = BABYLON.Vector3.Zero()

  constructor(name: string, position: BABYLON.Vector3, scene?: BABYLON.Scene, setActiveOnSceneIfNoneActive = true) {
    super(name, position, scene, setActiveOnSceneIfNoneActive)
    this.player.copyFrom(this.position)
    // FreeCamera adds keyboard+mouse; we use LocaleKeyboardMoveInput instead
    const keyboard = this.inputs.attached['keyboard']
    if (keyboard) this.inputs.remove(keyboard)
  }

  // babylon only calls _updatePosition when this is true; gravity and the orbit need every frame
  _decideIfNeedsToMove(): boolean {
    return true
  }

  private setup() {
    if (this.ready) return true
    const w = physics()
    if (!w) return false
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.player.x, this.player.y - DROP, this.player.z))
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), this.body)
    this.controller = w.createCharacterController(0.01)
    this.controller.enableAutostep(VoxelSize + 0.1, 0.2, true)
    this.controller.enableSnapToGround(0.3)
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
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

  _updatePosition(): void {
    const d = this.cameraDirection
    if (this.noclip || !this.setup()) {
      const dt = this.getEngine().getDeltaTime() / 1000 || 1 / 60
      this.player.addInPlace(d)
      this.grounded = false
      this.writeMotion(Math.hypot(d.x, d.z) / dt, 0)
      this.place()
      return
    }

    const dt = this.getEngine().getDeltaTime() / 1000 || 1 / 60
    // teleports and seat snaps move player behind our back: resync before querying
    this.body.setTranslation({ x: this.player.x, y: this.player.y - DROP, z: this.player.z }, true)

    if (this.vel > 0) this.controller.disableSnapToGround()
    else this.controller.enableSnapToGround(0.3)

    if (this.gravity) this.vel += GRAVITY * dt
    else if (this.vel > 0) {
      this.vel += GRAVITY * dt
      if (this.vel < 0) this.vel = 0
    } else {
      this.vel = 0
    }

    const dy = this.gravity ? this.vel * dt : d.y + this.vel * dt
    this.controller.computeColliderMovement(this.collider, { x: d.x, y: dy, z: d.z })
    let move = this.controller.computedMovement()
    const wantHz = d.x * d.x + d.z * d.z
    const gotHz = move.x * move.x + move.z * move.z
    // voxel KCC autostep misses 0.5m cubes; try one voxel up if the wall ate the walk
    if (this.vel <= 0 && wantHz > 1e-8 && gotHz < wantHz * 0.01) {
      this.controller.computeColliderMovement(this.collider, { x: d.x, y: dy + VoxelSize + 0.02, z: d.z })
      const stepped = this.controller.computedMovement()
      if (stepped.x * stepped.x + stepped.z * stepped.z > gotHz) move = stepped
    }
    const at = this.body.translation()
    const next = { x: at.x + move.x, y: at.y + move.y, z: at.z + move.z }
    this.body.setNextKinematicTranslation(next)
    this.player.set(next.x, next.y + DROP, next.z)

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
    this.writeMotion(Math.hypot(move.x, move.z) / dt, impact)
    if (this.grounded && this.vel <= 0) {
      this.vel = 0
      this.doubled = true
    }
    this.place()
  }

  /** first person sits on the eye; third person swings back, stopping short of whatever is behind */
  place() {
    if (this.distance <= 0) {
      this.position.copyFrom(this.player)
      return
    }
    const q = BABYLON.Quaternion.RotationYawPitchRoll(this.rotation.y, this.rotation.x, this.rotation.z)
    this.back.copyFromFloats(0, 0, -1).rotateByQuaternionToRef(q, this.back)

    let dist = this.distance
    const w = physics()
    if (w && this.ready) {
      const hit = w.castRay(new RAPIER.Ray(this.player, this.back), dist + ORBIT_MARGIN, true, undefined, undefined, undefined, this.body)
      if (hit) dist = Math.max(0, hit.timeOfImpact - ORBIT_MARGIN)
    }
    this.position.copyFrom(this.player).addInPlace(this.back.scaleInPlace(dist))
  }

  getClassName(): string {
    return 'PlayerCamera'
  }
}
