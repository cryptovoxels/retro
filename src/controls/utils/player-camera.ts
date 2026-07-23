const FRAME_DURATION_AT_60_FPS = 1000 / 60 // ms

// FreeCamera + custom jump/fall via inertiaVector
export default class PlayerCamera extends BABYLON.FreeCamera {
  inertiaVector = new BABYLON.Vector3(0, 0, 0)
  private collider: BABYLON.Collider = undefined!
  private old = BABYLON.Vector3.Zero()
  private diff = BABYLON.Vector3.Zero()
  private next = BABYLON.Vector3.Zero()
  private idlePos = BABYLON.Vector3.Zero()
  private idleRot = BABYLON.Vector3.Zero()

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
    }
  }

  // undo last idle, apply pos/rot * mix (no lookAt, just add)
  applyIdle(pos: BABYLON.Vector3, rot: BABYLON.Vector3, mix: number) {
    this.position.subtractInPlace(this.idlePos)
    this.rotation.subtractInPlace(this.idleRot)
    this.idlePos.copyFrom(pos).scaleInPlace(mix)
    this.idleRot.copyFrom(rot).scaleInPlace(mix)
    this.position.addInPlace(this.idlePos)
    this.rotation.addInPlace(this.idleRot)
  }

  clearIdle() {
    this.position.subtractInPlace(this.idlePos)
    this.rotation.subtractInPlace(this.idleRot)
    this.idlePos.setAll(0)
    this.idleRot.setAll(0)
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
