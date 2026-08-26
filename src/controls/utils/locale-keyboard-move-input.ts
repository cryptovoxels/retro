import { EngineContext, SceneContext, Vec3 } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'
import { patchVec3 } from '../../utils/vec3-compat'
// forked from BABYLON.FreeCameraKeyboardMoveInput with `keyCode` replaced with `code` for correct international keyboard handling
// https://github.com/BabylonJS/Babylon.js/blob/c843dcbc3875e9eee184152a10b857f7af9f4993/src/Cameras/Inputs/freeCameraKeyboardMoveInput.ts
// writes unitless direction into Controls.move; PlayerBody scales by speed * dt

interface LocaleKeyboardMoveInputOptions {
  keysUp?: string[]
  keysDown?: string[]
  keysLeft?: string[]
  keysRight?: string[]
  keysRotateLeft?: string[]
  keysRotateRight?: string[]
}

const localDir = patchVec3(vec3.create())
const worldDir = patchVec3(vec3.create())

export class LocaleKeyboardMoveInput /* todo(lite): implements BABYLON.ICameraInput<BABYLON.FreeCamera> */ {
  /**
   * Defines the camera the input is attached to.
   */
  public camera: any

  public keysUp: string[] = []
  public keysDown: string[] = []
  public keysLeft: string[] = []
  public keysRight: string[] = []
  public keysRotateLeft: string[] = []
  public keysRotateRight: string[] = []
  /** third person: W/S along this yaw (world XZ), not the camera look */
  public alongYaw: (() => number) | null = null
  /** third person: A/D turn the body, not the camera */
  public onTurn: ((delta: number) => void) | null = null
  /** unitless direction accumulator owned by Controls */
  public move: Vec3 = undefined!

  /**
   * Defines the pointer angular sensibility  along the X and Y axis or how fast is the camera rotating.
   */
  public rotationSpeed = 0.5

  private _keys = new Array<string>()
  private _attached = false
  private _onKeyDown = (evt: KeyboardEvent) => this.onKey(evt, true)
  private _onKeyUp = (evt: KeyboardEvent) => this.onKey(evt, false)
  private _onBlur = () => {
    this._keys = []
  }
  private _engine!: EngineContext
  private _scene!: SceneContext

  constructor(options: LocaleKeyboardMoveInputOptions) {
    Object.assign(this, options)
  }

  public reset() {
    this._keys = []
  }

  /** codes currently held (for vehicle mode / hijacks that need WASD without moving the camera) */
  public pressedCodes(): string[] {
    return this._keys.slice()
  }

  /**
   * Attach the input controls to a specific dom element to get the input from.
   * @param noPreventDefault Defines whether event caught by the controls should call preventdefault() (https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
   */
  public attachControl(_noPreventDefault?: boolean): void {
    if (this._attached) return
    this._attached = true
    this._scene = this.camera.getScene()
    this._engine = this._scene.getEngine()
    document.addEventListener('keydown', this._onKeyDown)
    document.addEventListener('keyup', this._onKeyUp)
    this._engine.getRenderingCanvas()?.addEventListener('blur', this._onBlur)
  }

  private onKey(evt: KeyboardEvent, down: boolean) {
    if (evt.metaKey) return
    const moveKey =
      this.keysUp.includes(evt.code) ||
      this.keysDown.includes(evt.code) ||
      this.keysLeft.includes(evt.code) ||
      this.keysRight.includes(evt.code) ||
      this.keysRotateLeft.includes(evt.code) ||
      this.keysRotateRight.includes(evt.code)
    if (!moveKey) return

    const index = this._keys.indexOf(evt.code)
    if (down) {
      if (index === -1) this._keys.push(evt.code)
    } else if (index >= 0) {
      this._keys.splice(index, 1)
    }
  }

  public detachControl(): void {
    if (!this._attached) return
    this._attached = false
    document.removeEventListener('keydown', this._onKeyDown)
    document.removeEventListener('keyup', this._onKeyUp)
    this._engine?.getRenderingCanvas()?.removeEventListener('blur', this._onBlur)
    this._keys = []
  }

  /**
   * Update the current camera state depending on the inputs that have been used this frame.
   * This is a dynamically created lambda to avoid the performance penalty of looping for inputs in the render loop.
   */
  public checkInputs(): void {
    if (!this._attached || !this.move) return
    const camera = this.camera as any
    const yaw = this.alongYaw?.() ?? camera.rotation?.y ?? 0
    const sy = Math.sin(yaw)
    const cy = Math.cos(yaw)
    for (let index = 0; index < this._keys.length; index++) {
      const keyCode = this._keys[index]

      if (this.keysRotateLeft.indexOf(keyCode) !== -1) {
        if (this.onTurn) this.onTurn(-this._getLocalRotation())
        else camera.cameraRotation.y -= this._getLocalRotation()
        continue
      }
      if (this.keysRotateRight.indexOf(keyCode) !== -1) {
        if (this.onTurn) this.onTurn(this._getLocalRotation())
        else camera.cameraRotation.y += this._getLocalRotation()
        continue
      }

      if (this.alongYaw != null && this.keysUp.indexOf(keyCode) !== -1) {
        this.move.addInPlaceFromFloats(sy, 0, cy)
        continue
      }
      if (this.alongYaw != null && this.keysDown.indexOf(keyCode) !== -1) {
        this.move.addInPlaceFromFloats(-sy, 0, -cy)
        continue
      }

      if (this.keysLeft.indexOf(keyCode) !== -1) {
        localDir.copyFromFloats(-1, 0, 0)
      } else if (this.keysUp.indexOf(keyCode) !== -1) {
        localDir.copyFromFloats(0, 0, 1)
      } else if (this.keysRight.indexOf(keyCode) !== -1) {
        localDir.copyFromFloats(1, 0, 0)
      } else if (this.keysDown.indexOf(keyCode) !== -1) {
        localDir.copyFromFloats(0, 0, -1)
      } else {
        continue
      }

      worldDir.x = localDir.x * cy + localDir.z * sy
      worldDir.y = 0
      worldDir.z = -localDir.x * sy + localDir.z * cy
      this.move.addInPlace(worldDir)
    }
  }

  /**
   * Gets the class name of the current input.
   * @returns the class name
   */
  public getClassName(): string {
    return 'LocaleKeyboardMoveInput'
  }

  /** @hidden */
  public _onLostFocus(): void {
    this._keys = []
  }

  /**
   * Get the friendly name associated with the input class.
   * @returns the input friendly name
   */
  public getSimpleName(): string {
    return 'localeKeyboard'
  }

  private _getLocalRotation(): number {
    let rotation = (this.rotationSpeed * this._engine.getDeltaTime()) / 1000
    const camera = this.camera as any
    if (camera.parent && camera.parent._getWorldMatrixDeterminant?.() < 0) {
      rotation *= -1
    }
    return rotation
  }
}
