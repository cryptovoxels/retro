const FRAME_DURATION_AT_60_FPS = 1000 / 60 // ms

// FreeCamera + custom jump/fall via inertiaVector
export default class PlayerCamera extends BABYLON.FreeCamera {
  inertiaVector = new BABYLON.Vector3(0, 0, 0)
  doubleJump = true // available until spent mid-air
  private collider: BABYLON.Collider = undefined!
  private old = BABYLON.Vector3.Zero()
  private diff = BABYLON.Vector3.Zero()
  private next = BABYLON.Vector3.Zero()
  private idlePos = BABYLON.Vector3.Zero()
  private idleBase = BABYLON.Quaternion.Identity()
  private idleApplied = false

  constructor(name: string, position: BABYLON.Vector3, scene?: BABYLON.Scene, setActiveOnSceneIfNoneActive = true) {
    super(name, position, scene, setActiveOnSceneIfNoneActive)
    this.needMoveForGravity = true
    this.ellipsoidOffset = new BABYLON.Vector3(0, 0.1, 0)
    // FreeCamera adds keyboard+mouse; we use LocaleKeyboardMoveInput instead
    const keyboard = this.inputs.attached['keyboard']
    if (keyboard) this.inputs.remove(keyboard)
  }

  jump() {
    if (this.inertiaVector.y === 0) {
      this.inertiaVector.y = 0.1
      return
    }
    if (this.doubleJump) {
      this.doubleJump = false
      this.inertiaVector.y = 0.1
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
    let globalPosition: BABYLON.Vector3

    if (this.parent) {
      globalPosition = BABYLON.Vector3.TransformCoordinates(this.position, this.parent.getWorldMatrix())
    } else {
      globalPosition = this.position
    }

    globalPosition.subtractFromFloatsToRef(0, this.ellipsoid.y, 0, this.old)
    this.old.addInPlace(this.ellipsoidOffset)

    const coordinator = this.getScene().collisionCoordinator
    if (!this.collider) {
      this.collider = coordinator.createCollider()
    }

    this.collider._radius = this.ellipsoid
    this.collider.collisionMask = this.collisionMask

    let actualDisplacement = displacement

    if (this.applyGravity) {
      actualDisplacement = displacement.clone()

      let inertiaVectorY = this.inertiaVector.y

      // falling: factor in render time so fall speed isn't affected by frame rate
      if (inertiaVectorY < 0) {
        const currentFPSMultipleOfTargetFPS = FRAME_DURATION_AT_60_FPS / this.getEngine().getDeltaTime()
        inertiaVectorY = inertiaVectorY / currentFPSMultipleOfTargetFPS
      }

      actualDisplacement.y = inertiaVectorY - 0.01
    }

    coordinator.getNewPosition(this.old, actualDisplacement, this.collider, 3, null, this.onHit, this.uniqueId)
  }

  getClassName(): string {
    return 'PlayerCamera'
  }

  private onHit = (_collisionId: number, newPosition: BABYLON.Vector3, collidedMesh: BABYLON.Nullable<BABYLON.AbstractMesh> = null) => {
    const EPSILON = 0.001
    const airborne = Math.abs(newPosition.y - this.old.y) > EPSILON

    if (airborne) {
      this.inertiaVector.y -= 0.003
    } else {
      this.inertiaVector.y = 0
      this.doubleJump = true
    }

    this.next.copyFrom(newPosition)
    this.next.subtractToRef(this.old, this.diff)

    if (this.diff.length() > BABYLON.Engine.CollisionsEpsilon) {
      this.position.addInPlace(this.diff)
      if (this.onCollide && collidedMesh) {
        this.onCollide(collidedMesh)
      }
    }
  }
}
