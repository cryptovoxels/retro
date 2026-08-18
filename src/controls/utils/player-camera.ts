import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'

const JUMP_SPEED = 6 // m/s (was 0.1 per frame at 60fps)
const GRAVITY = -10.8 // m/s^2 (was 0.003 per frame^2)

// FreeCamera + rapier kinematic character controller
export default class PlayerCamera extends BABYLON.FreeCamera {
  inertiaVector = new BABYLON.Vector3(0, 0, 0)
  doubleJump = true // available until spent mid-air
  private idlePos = BABYLON.Vector3.Zero()
  private idleBase = BABYLON.Quaternion.Identity()
  private idleApplied = false
  private body: any = null
  private collider: any = null
  private controller: any = null
  private verticalVel = 0
  grounded = false

  constructor(name: string, position: BABYLON.Vector3, scene?: BABYLON.Scene, setActiveOnSceneIfNoneActive = true) {
    super(name, position, scene, setActiveOnSceneIfNoneActive)
    this.needMoveForGravity = true
    this.ellipsoidOffset = new BABYLON.Vector3(0, 0.1, 0)
    // FreeCamera adds keyboard+mouse; we use LocaleKeyboardMoveInput instead
    const keyboard = this.inputs.attached['keyboard']
    if (keyboard) this.inputs.remove(keyboard)
  }

  // capsule center sits ellipsoid.y below the camera eye (plus the old ellipsoidOffset)
  private bodyYFromCamera() {
    return this.position.y - this.ellipsoid.y + this.ellipsoidOffset.y
  }

  private cameraYFromBody(bodyY: number) {
    return bodyY + this.ellipsoid.y - this.ellipsoidOffset.y
  }

  ensurePhysics() {
    const w = physics()
    if (!w || this.controller) return
    const halfH = Math.max(0.05, this.ellipsoid.y - this.ellipsoid.x)
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.bodyYFromCamera(), this.position.z)
    this.body = w.createRigidBody(bodyDesc)
    const colDesc = RAPIER.ColliderDesc.capsule(halfH, this.ellipsoid.x)
    this.collider = w.createCollider(colDesc, this.body)
    this.controller = w.createCharacterController(0.01)
    this.controller.enableAutostep(0.5, 0.2, true)
    this.controller.enableSnapToGround(0.3)
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
  }

  rebuildCapsule() {
    const w = physics()
    if (!w || !this.body) return
    if (this.collider) w.removeCollider(this.collider, true)
    const halfH = Math.max(0.05, this.ellipsoid.y - this.ellipsoid.x)
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(halfH, this.ellipsoid.x), this.body)
  }

  jump() {
    if (this.grounded || this.verticalVel === 0) {
      this.verticalVel = JUMP_SPEED
      this.grounded = false
      return
    }
    if (this.doubleJump) {
      this.doubleJump = false
      this.verticalVel = JUMP_SPEED
    }
  }

  // apply offset * mix and slerp(baseEuler, lookQuat, mix)
  applyIdle(pos: BABYLON.Vector3, look: BABYLON.Quaternion, mix: number) {
    this.clearIdle()

    this.idlePos.copyFrom(pos).scaleInPlace(mix)
    this.position.addInPlace(this.idlePos)

    BABYLON.Quaternion.FromEulerAnglesToRef(this.rotation.x, this.rotation.y, this.rotation.z, this.idleBase)
    if (mix <= 0) return

    if (!this.rotationQuaternion) this.rotationQuaternion = BABYLON.Quaternion.Identity()
    BABYLON.Quaternion.SlerpToRef(this.idleBase, look, mix, this.rotationQuaternion)
    this.idleApplied = true
  }

  clearIdle() {
    if (this.idlePos.lengthSquared() > 0) {
      this.position.subtractInPlace(this.idlePos)
      this.idlePos.setAll(0)
    }
    if (this.idleApplied) {
      this.rotationQuaternion = null as any
      this.idleApplied = false
    }
  }

  _collideWithWorld(displacement: BABYLON.Vector3): void {
    this.ensurePhysics()
    if (!this.controller || !this.collider || !this.body) {
      this.position.addInPlace(displacement)
      return
    }

    const dt = this.getEngine().getDeltaTime() / 1000 || 1 / 60

    // keep body glued to the camera before querying (teleports / fly / etc)
    this.body.setTranslation({ x: this.position.x, y: this.bodyYFromCamera(), z: this.position.z }, true)

    let dx = displacement.x
    let dy = displacement.y
    let dz = displacement.z

    if (this.applyGravity) {
      this.verticalVel += GRAVITY * dt
      dy = this.verticalVel * dt
    } else {
      this.verticalVel = 0
    }

    this.controller.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz })
    const mov = this.controller.computedMovement()
    const t = this.body.translation()
    const next = { x: t.x + mov.x, y: t.y + mov.y, z: t.z + mov.z }
    this.body.setNextKinematicTranslation(next)
    this.position.set(next.x, this.cameraYFromBody(next.y), next.z)

    this.grounded = !!this.controller.computedGrounded()
    if (this.grounded) {
      this.verticalVel = 0
      this.inertiaVector.y = 0
      this.doubleJump = true
    } else {
      this.inertiaVector.y = this.verticalVel
    }
  }

  getClassName(): string {
    return 'PlayerCamera'
  }
}
