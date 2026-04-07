import Controls, { MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from '../controls'

import OurCamera from '../utils/our-camera'
import { LocaleKeyboardMoveInput } from '../utils/locale-keyboard-move-input'
import { clamp } from 'lodash'
import { unmountComponentAtNode } from 'preact/compat'
import { createFirstPersonCamera } from '../utils/fps-camera'
import { decodeCoordsFromURL } from '../../utils/helpers'
import { hasPointerLock } from '../../../common/helpers/ui-helpers'
import { isSafari } from '../../../common/helpers/detector'
import { Scene } from '../../scene'

const POINTER_WHEEL_MULTIPLIER = 0.001
export default class DesktopControls extends Controls {
  keyboardInput?: LocaleKeyboardMoveInput
  origUpdatePointerPosition?: () => void
  nerfingClickEvents = false

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    super(scene, canvas)

    // disable picking unless in pointer lock mode
    scene.skipPointerUpPicking = true
    scene.skipPointerDownPicking = true
    scene.skipPointerMovePicking = true

    // if we ever add multiple scenes, we'll need to deal with dispose etc
    document.addEventListener(
      'pointerlockchange',
      () => {
        if (document.pointerLockElement === scene.getEngine().getRenderingCanvas()) {
          scene.preventDefaultOnPointerDown = true
          scene.preventDefaultOnPointerUp = true
          scene.skipPointerUpPicking = false
          scene.skipPointerDownPicking = false
          scene.skipPointerMovePicking = false
        } else {
          scene.preventDefaultOnPointerDown = false
          scene.preventDefaultOnPointerUp = false
          scene.skipPointerUpPicking = true
          scene.skipPointerDownPicking = true
          scene.skipPointerMovePicking = true
        }
      },
      false,
    )
  }

  createCamera() {
    const coords = decodeCoordsFromURL()
    const camera = createFirstPersonCamera(this.scene, coords)
    this.resetWorldOffset(coords.position)

    if (coords && coords.rotation) {
      camera['rotation'].y = coords?.rotation.y || 0
    }

    return camera
  }

  addControls(camera: OurCamera) {
    // noPreventDefault: true to fix pointer lock while mouse down in firefox
    camera.attachControl(this.canvas, true)
    this.addPointerLockHandler()

    this.addKeyboardControls(camera)
    this.addGamepadControls(camera)

    // Bind to easy adding/removing this from observable registries
    // Note that using the runtime property style to create these won't work, as subclass property
    // initialisers can't be referenced from the parent constructor
    this.featureSelectorObservable = this.featureSelectorObservable.bind(this)

    this.addFeatureSelector()
  }

  /// POINTERLOCK

  dispose() {
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)

    this.scene.onPointerObservable.removeCallback(this.featureSelectorObservable)

    // TODO: dispose of all BABYLON-reigstered handlers
  }

  /**
   * Disable the babylon picker so that pointer events won't interact with the world
   */
  babylonNormalMouse() {
    // Restore _updatePointerPosition to normal behaviour
    if (this.origUpdatePointerPosition !== undefined) {
      ;(<any>this.scene._inputManager)._updatePointerPosition = this.origUpdatePointerPosition
    }
  }

  /**
   * Enable the babylon picker so that pointer events will interact with the world
   */
  babylonPointerLock() {
    // Replace _updatePointerPosition with a pointerlock-based one
    if (this.origUpdatePointerPosition === undefined) {
      this.origUpdatePointerPosition = (<any>this.scene._inputManager)._updatePointerPosition
    }

    ;(<any>this.scene._inputManager)._updatePointerPosition = function () {
      const canvasRect = this._scene.getEngine().getInputElementClientRect()
      if (!canvasRect) {
        return
      }
      this._pointerX = canvasRect.width / 2
      this._pointerY = canvasRect.height / 2
      this._unTranslatedPointerX = this._pointerX
      this._unTranslatedPointerY = this._pointerY
    }
  }

  /**
   * Switch babylon pointer position logic based on pointerlock state
   */
  onPointerLockChange() {
    if (document.pointerLockElement === null) {
      // lost pointer lock
      // if (window.ui?.parcelTabs?.isOpen) {
      //   window.ui?.deactivateTools()
      // } else {
      //   window.ui?.deactivateToolsAndUnHighlightSelection()
      // }
      this.resetControls()
      this.babylonNormalMouse()
    } else {
      this.babylonPointerLock()
    }
  }

  resetControls() {
    this.shiftKey = false
    this.ctrlKey = false
    this.walk()
    this.keyboardInput?.reset()
  }

  /**
   * On the desktop, features can only be clicked in pointerlock mode
   */
  isFeatureClickingAllowed(): boolean {
    return super.isFeatureClickingAllowed() && hasPointerLock()
  }

  /**
   * PointerObservable handler for activating pointerlock
   */
  pointerLockHandler(eventData: any, eventState: BABYLON.EventState) {
    // Nerf handlers - keep nerfing all mouse events until the next UP
    if (this.nerfingClickEvents) {
      if (eventData.type === BABYLON.PointerEventTypes.POINTERUP) {
        this.nerfingClickEvents = false
      }
      eventState.skipNextObservers = true
      return
    }

    // Left-mouse-down
    if (eventData.event.button === 0 && eventData.type === BABYLON.PointerEventTypes.POINTERDOWN && !hasPointerLock()) {
      // Skip even if the pointerlock request fails
      eventState.skipNextObservers = true
      // Nerf all other mouse events (move, tap, pick, up) until the next up (which comes last in that list)
      this.nerfingClickEvents = true

      // Ignore the promise failure; it means that the browser didn't allow the transition to pointerlock but that's okay
      this.requestPointerLock()?.catch(() => {
        // Browser didn't allow pointer lock transition - this is expected behavior
      })
    }
  }

  addPointerLockHandler() {
    if (isSafari()) {
      ;(<any>this.scene._inputManager)._updatePointerPosition = () => {
        // Safari-specific override - disables pointer position updates due to compatibility issues
        // This prevents input manager from updating pointer coordinates on Safari
      }

      this.babylonNormalMouse()
      return
    }

    // Pointerlock listener to only enable babylon picking behaviour while in pointerlock
    this.onPointerLockChange = this.onPointerLockChange.bind(this)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)

    this.scene.onPointerObservable.add(this.pointerLockHandler.bind(this), undefined, true)
  }

  /// FEATURE SELECTOR - right click to select features

  addFeatureSelector() {
    this.scene.onPointerObservable.add(this.featureSelectorObservable, undefined, true)
  }

  featureSelectorObservable(eventData: BABYLON.PointerInfo, eventState: BABYLON.EventState) {
    // Transform picked point to world coordinates
    // This occurs before other observers and modifies the event data handed to other observers
    if (eventData.pickInfo?.pickedPoint) {
      eventData.pickInfo.pickedPoint = eventData.pickInfo.pickedPoint.subtract(this.worldOffset.position)
    }

    switch (eventData.type) {
      // Handle pointer wheel
      case BABYLON.PointerEventTypes.POINTERWHEEL:
        this.handlePointerWheel((<any>eventData.event).deltaY)
        break

      case BABYLON.PointerEventTypes.POINTERTAP:
        // Middle-click = toggle perspective
        if (eventData.event.button === 1) {
          this.togglePerspective()
        }
        // Right-click only
        if (eventData.event.button === 2) {
          this.handleContextClick(eventData.pickInfo)
          eventState.skipNextObservers = true
        }
        break
      case BABYLON.PointerEventTypes.POINTERMOVE:
        const metadata = eventData.pickInfo?.pickedMesh?.metadata
        const distance = eventData.pickInfo?.distance || Infinity

        if (metadata && !!metadata.isInteractive && distance < this.MAX_PICK_DISTANCE) {
          this.setActiveReticule(true)
        } else {
          this.setActiveReticule(false)
        }
    }
  }

  handlePointerWheel(delta: number) {
    if (this.firstPersonView) {
      // if a user is in build mode, don't allow switching to third person via scroll wheel (UX)
      // Also add a treshold of delta>=5 instead of 0 (Note: some mouses always report a delta= 10 by default)
      if (delta >= 5 && !window.ui?.activeTool) {
        this.enterThirdPerson(MIN_CAMERA_DISTANCE)
      }
    } else {
      this.targetCameraDistance = clamp(this.targetCameraDistance + delta * POINTER_WHEEL_MULTIPLIER, 0, MAX_CAMERA_DISTANCE)

      if (this.targetCameraDistance <= MIN_CAMERA_DISTANCE) {
        this.enterFirstPerson()
      }
    }
  }

  /// KEYBOARD

  addKeyboardControls(camera: BABYLON.Camera) {
    // Moving the camera
    this.keyboardInput = new LocaleKeyboardMoveInput({
      keysUp: ['ArrowUp', 'KeyW'],
      keysUpward: ['PageUp', 'Space', 'KeyF'],
      keysDown: ['ArrowDown', 'KeyS'],
      keysDownward: ['PageDown', 'KeyV'],
      keysLeft: ['ArrowLeft', 'KeyA'],
      keysRight: ['ArrowRight', 'KeyD'],
    })
    camera.inputs.add(this.keyboardInput)

    // Extra handlers for the running and avatar facing direction
    this.canvas.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return

      this.shiftKey = e.shiftKey
      this.ctrlKey = e.ctrlKey || e.metaKey

      const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']
      if (this.followTarget && movementKeys.includes(e.code)) {
        this.stopFollowing()
      }

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.run()
      } else if (this.running && !this.shiftKey) {
        // ensure shift key is down to continue running, otherwise revert to walking
        this.walk()
      }

      // Check if key down is pressed
      // only set facing forward=false if in 3rd person view
      if ((e.code === 'KeyS' || e.code === 'ArrowDown') && !this.firstPersonView) {
        this.facingForward = false
      }

      // Check if key up is pressed
      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        this.facingForward = true
      }
    })

    // Key-up: end of running
    window.addEventListener('keyup', (e) => {
      this.shiftKey = e.shiftKey
      this.ctrlKey = e.ctrlKey || e.metaKey

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.walk()
      }
    })

    // Spacebar for jump
    this.scene.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        {
          trigger: BABYLON.ActionManager.OnKeyDownTrigger,
          parameter: ' ',
        },
        () => (this.jumping = true),
      ),
    )
    this.scene.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(
        {
          trigger: BABYLON.ActionManager.OnKeyUpTrigger,
          parameter: ' ',
        },
        () => (this.jumping = false),
      ),
    )
  }

  /// GAME PAD

  addGamepadControls(camera: OurCamera) {
    camera.inputs.addGamepad()
    const gamepad = <BABYLON.FreeCameraGamepadInput>camera.inputs.attached['gamepad']

    gamepad.gamepadAngularSensibility = 40

    const gamepadManager = new BABYLON.GamepadManager(this.scene)
    gamepadManager.onGamepadConnectedObservable.add((gamepad) => {
      console.log('Gamepad detected')
      if ((gamepad as any)['onButtonDownObservable']) {
        this.hasGamepad = gamepadManager.gamepads.some((g) => g.isConnected)
        ;(gamepad as any)['onButtonDownObservable'].add((buttonId: any) => {
          const button = this.getGamepadButton(gamepad, buttonId)
          if (button) {
            this.onGamepadButton(button, true)
          }
        })
        ;(gamepad as any)['onButtonUpObservable'].add((buttonId: any) => {
          const button = this.getGamepadButton(gamepad, buttonId)
          if (button) {
            this.onGamepadButton(button, false)
          }
        })
      }
    })

    gamepadManager.onGamepadDisconnectedObservable.add(() => {
      this.hasGamepad = gamepadManager.gamepads.some((g) => g.isConnected)
    })
  }

  onGamepadButton(button: string, pressed: boolean) {
    if (button === 'LeftStick') {
      if (pressed) this.toggleRun()
    } else if (button === 'Cross' || button === 'A') {
      if (pressed) {
        if ('jump' in this.camera) {
          this.camera.jump()
        }
      }
    } else if (button === 'Circle' || button === 'B') {
      if (pressed) this.toggleFlying()
    } else if (button === 'R1' || button === 'RB') {
      // Synthetic left-click at the reticule position
      const canvasRect = this.scene.getEngine().getInputElementClientRect()
      if (canvasRect) {
        this.syntheticMouseDown(canvasRect.width / 2, canvasRect.height / 2, 0)
      }
    }
  }

  syntheticMouseDown(x: number, y: number, button: number) {
    const options = {
      bubbles: true,
      cancelable: false,
      button: button,
      clientX: x,
      clientY: y,
      screenX: x,
      scfreenY: y,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    }
    const oEvent = new PointerEvent('pointerdown', options)
    this.canvas.dispatchEvent(oEvent)
  }

  getGamepadButton(gamepad: any, button: any) {
    if (gamepad instanceof BABYLON.DualShockPad) {
      return BABYLON.DualShockButton[button]
    } else if (gamepad instanceof BABYLON.Xbox360Pad) {
      return BABYLON.Xbox360Button[button]
    }
  }

  requestPointerLock() {
    // hack to close overlays when clicking canvas
    document.querySelectorAll('.pointer-lock-close').forEach((element) => {
      unmountComponentAtNode(element)
      element.remove()
    })

    // Deactivate UI tools
    window.ui?.hide()
    window.ui?.deactivateToolsAndUnHighlightSelection()

    // Chrome return as promise here
    this.canvas.focus()

    if (isSafari()) {
      return
    }

    const maybePromise: unknown = this.canvas.requestPointerLock()
    if (maybePromise instanceof Promise) {
      return maybePromise
    }

    // Firefox expects you to trap two document events; we convert them to a promise below
    return new Promise<Event>((resolve, reject) => {
      const removeEvents = () => {
        document.removeEventListener('pointerlockerror', pointerLockError)
        document.removeEventListener('pointerlockchange', pointerLockSuccess)
      }
      const pointerLockError = (e: Event) => {
        removeEvents()
        reject(e)
      }
      const pointerLockSuccess = (e: Event) => {
        removeEvents()
        resolve(e)
      }

      document.addEventListener('pointerlockerror', pointerLockError)
      document.addEventListener('pointerlockchange', pointerLockSuccess)
    })
  }
}
