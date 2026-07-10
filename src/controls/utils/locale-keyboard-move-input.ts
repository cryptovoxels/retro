// forked from BABYLON.FreeCameraKeyboardMoveInput with `keyCode` replaced with `code` for correct international keyboard handling
// https://github.com/BabylonJS/Babylon.js/blob/c843dcbc3875e9eee184152a10b857f7af9f4993/src/Cameras/Inputs/freeCameraKeyboardMoveInput.ts

interface LocaleKeyboardMoveInputOptions {
  keysUp?: string[]
  keysDown?: string[]
  keysUpward?: string[]
  keysDownward?: string[]
  keysLeft?: string[]
  keysRight?: string[]
  keysRotateLeft?: string[]
  keysRotateRight?: string[]
}

export class LocaleKeyboardMoveInput implements BABYLON.ICameraInput<BABYLON.FreeCamera> {
  /**
   * Defines the camera the input is attached to.
   */
  // @ts-expect-error - Camera property is set by Babylon.js framework
  public camera: BABYLON.FreeCamera

  public keysUp: string[] = []
  public keysUpward: string[] = []
  public keysDown: string[] = []
  public keysDownward: string[] = []
  public keysLeft: string[] = []
  public keysRight: string[] = []
  public keysRotateLeft: string[] = []
  public keysRotateRight: string[] = []

  /**
   * Defines the pointer angular sensibility  along the X and Y axis or how fast is the camera rotating.
   */
  public rotationSpeed = 0.5

  private _keys = new Array<string>()
  // @ts-expect-error - Observer types not fully compatible
  private _onCanvasBlurObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Engine>>
  // @ts-expect-error - Observer types not fully compatible
  private _onKeyboardObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.KeyboardInfo>>
  // @ts-expect-error - Engine property set during initialization
  private _engine: BABYLON.Engine
  // @ts-expect-error - Scene property set during initialization
  private _scene: BABYLON.Scene

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
  public attachControl(noPreventDefault?: boolean): void {
    noPreventDefault = BABYLON.Tools.BackCompatCameraNoPreventDefault(arguments)
    if (this._onCanvasBlurObserver) {
      return
    }

    this._scene = this.camera.getScene()
    this._engine = this._scene.getEngine()

    this._onCanvasBlurObserver = this._engine.onCanvasBlurObservable.add(() => {
      this._keys = []
    })

    this._onKeyboardObserver = this._scene.onKeyboardObservable.add((info) => {
      const evt = info.event
      if (!evt.metaKey) {
        if (info.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
          if (
            this.keysUp.indexOf(evt.code) !== -1 ||
            this.keysDown.indexOf(evt.code) !== -1 ||
            this.keysLeft.indexOf(evt.code) !== -1 ||
            this.keysRight.indexOf(evt.code) !== -1 ||
            this.keysUpward.indexOf(evt.code) !== -1 ||
            this.keysDownward.indexOf(evt.code) !== -1 ||
            this.keysRotateLeft.indexOf(evt.code) !== -1 ||
            this.keysRotateRight.indexOf(evt.code) !== -1
          ) {
            const index = this._keys.indexOf(evt.code)

            if (index === -1) {
              this._keys.push(evt.code)
            }
            if (!noPreventDefault) {
              evt.preventDefault()
            }
          }
        } else {
          if (
            this.keysUp.indexOf(evt.code) !== -1 ||
            this.keysDown.indexOf(evt.code) !== -1 ||
            this.keysLeft.indexOf(evt.code) !== -1 ||
            this.keysRight.indexOf(evt.code) !== -1 ||
            this.keysUpward.indexOf(evt.code) !== -1 ||
            this.keysDownward.indexOf(evt.code) !== -1 ||
            this.keysRotateLeft.indexOf(evt.code) !== -1 ||
            this.keysRotateRight.indexOf(evt.code) !== -1
          ) {
            const index = this._keys.indexOf(evt.code)

            if (index >= 0) {
              this._keys.splice(index, 1)
            }
            if (!noPreventDefault) {
              evt.preventDefault()
            }
          }
        }
      }
    })
  }

  /**
   * Detach the current controls from the specified dom element.
   */
  public detachControl(): void

  /**
   * Detach the current controls from the specified dom element.
   * @param ignored defines an ignored parameter kept for backward compatibility. If you want to define the source input element, you can set engine.inputElement before calling camera.attachControl
   */
  public detachControl(): void {
    if (this._scene) {
      if (this._onKeyboardObserver) {
        this._scene.onKeyboardObservable.remove(this._onKeyboardObserver)
      }

      if (this._onCanvasBlurObserver) {
        this._engine.onCanvasBlurObservable.remove(this._onCanvasBlurObserver)
      }
      this._onKeyboardObserver = null
      this._onCanvasBlurObserver = null
    }
    this._keys = []
  }

  /**
   * Update the current camera state depending on the inputs that have been used this frame.
   * This is a dynamically created lambda to avoid the performance penalty of looping for inputs in the render loop.
   */
  public checkInputs(): void {
    if (this._onKeyboardObserver) {
      const camera = this.camera
      // Keyboard
      for (let index = 0; index < this._keys.length; index++) {
        const keyCode = this._keys[index]
        const speed = camera._computeLocalCameraSpeed()

        if (this.keysLeft.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(-speed, 0, 0)
        } else if (this.keysUp.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, 0, speed)
        } else if (this.keysRight.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(speed, 0, 0)
        } else if (this.keysDown.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, 0, -speed)
        } else if (this.keysUpward.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, speed, 0)
        } else if (this.keysDownward.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, -speed, 0)
        } else if (this.keysRotateLeft.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, 0, 0)
          camera.cameraRotation.y -= this._getLocalRotation()
        } else if (this.keysRotateRight.indexOf(keyCode) !== -1) {
          camera._localDirection.copyFromFloats(0, 0, 0)
          camera.cameraRotation.y += this._getLocalRotation()
        }

        if (camera.getScene().useRightHandedSystem) {
          camera._localDirection.z *= -1
        }

        camera.getViewMatrix().invertToRef(camera._cameraTransformMatrix)
        BABYLON.Vector3.TransformNormalToRef(camera._localDirection, camera._cameraTransformMatrix, camera._transformedDirection)
        camera.cameraDirection.addInPlace(camera._transformedDirection)
      }
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
    if (this.camera.getScene().useRightHandedSystem) {
      rotation *= -1
    }
    if (this.camera.parent && this.camera.parent._getWorldMatrixDeterminant() < 0) {
      rotation *= -1
    }
    return rotation
  }
}
