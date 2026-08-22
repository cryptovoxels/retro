import RAPIER from '@dimforge/rapier3d-compat'
import { physics } from '../../physics/world'
import type PlayerBody from './player-body'

const ORBIT_MARGIN = 0.3 // keep the lens off the wall it just hit

// FreeCamera owns look direction. PlayerBody owns where the feet can go.
// Place the lens on the eye, or swing it back for third person.
export default class PlayerCamera extends BABYLON.FreeCamera {
  /** metres behind the eye; Controls eases this */
  distance = 0
  body: PlayerBody = undefined!
  private back = BABYLON.Vector3.Zero()

  constructor(name: string, position: BABYLON.Vector3, scene?: BABYLON.Scene, setActiveOnSceneIfNoneActive = true) {
    super(name, position, scene, setActiveOnSceneIfNoneActive)
    // FreeCamera adds keyboard+mouse; we use LocaleKeyboardMoveInput instead
    const keyboard = this.inputs.attached['keyboard']
    if (keyboard) this.inputs.remove(keyboard)
  }

  // stock TargetCamera would add cameraDirection to position and fight place()
  _decideIfNeedsToMove(): boolean {
    return false
  }

  /** first person sits on the eye; third person swings back, stopping short of whatever is behind */
  place() {
    if (this.distance <= 0) {
      this.position.copyFrom(this.body.position)
      return
    }
    const q = BABYLON.Quaternion.RotationYawPitchRoll(this.rotation.y, this.rotation.x, this.rotation.z)
    this.back.copyFromFloats(0, 0, -1).rotateByQuaternionToRef(q, this.back)

    let dist = this.distance
    const w = physics()
    if (w && this.body.blocker) {
      const hit = w.castRay(new RAPIER.Ray(this.body.position, this.back), dist + ORBIT_MARGIN, true, undefined, undefined, undefined, this.body.blocker)
      if (hit) dist = Math.max(0, hit.timeOfImpact - ORBIT_MARGIN)
    }
    this.position.copyFrom(this.body.position).addInPlace(this.back.scaleInPlace(dist))
  }

  getClassName(): string {
    return 'PlayerCamera'
  }
}
