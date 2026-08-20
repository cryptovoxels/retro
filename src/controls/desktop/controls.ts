import Controls, { CAMERA_DISTANCE, featureFromPick, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from '../controls'

import PlayerCamera from '../utils/player-camera'
import { LocaleKeyboardMoveInput } from '../utils/locale-keyboard-move-input'
import { clamp } from 'lodash'
import { unmountComponentAtNode } from 'preact/compat'
import { createFirstPersonCamera } from '../utils/fps-camera'
import { decodeCoordsFromURL } from '../../utils/helpers'
import { hasPointerLock, isFastviewBlocking } from '../../../common/helpers/ui-helpers'
import { uiPane } from '../../store'
import { app, AppEvent } from '../../../web/src/state'
const POINTER_WHEEL_MULTIPLIER = 0.001
export default class DesktopControls extends Controls {
  keyboardInput?: LocaleKeyboardMoveInput
  private lockListener?: () => void
  private nerfClick = false
  private mouseLookAttached = false

  constructor(scene: BABYLON.Scene, canvas: HTMLCanvasElement) {
    super(scene, canvas)

    scene.skipPointerUpPicking = false
    scene.skipPointerDownPicking = false
    scene.skipPointerMovePicking = false

    this.onPointerLockChange()
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

  override setFlying(value: boolean) {
    super.setFlying(value)
    if (this.keyboardInput) {
      this.keyboardInput.keysUpward = value ? ['PageUp'] : []
      this.keyboardInput.keysDownward = value ? ['PageDown', 'KeyV'] : []
    }
  }

  override enterThirdPerson(startingDistance = CAMERA_DISTANCE) {
    const entered = super.enterThirdPerson(startingDistance)
    this.bindKeys()
    return entered
  }

  override enterFirstPerson() {
    const entered = super.enterFirstPerson()
    this.bindKeys()
    return entered
  }

  private bindKeys() {
    const kb = this.keyboardInput
    if (!kb) return
    const turn = ['ArrowLeft', 'KeyA']
    const other = ['ArrowRight', 'KeyD']
    // W/S always follow look yaw (horizontal). Third person keeps A/D as strafe too —
    // body-turn Diablo walk made "look then walk" go the wrong way.
    kb.keysLeft = turn
    kb.keysRight = other
    kb.keysRotateLeft = []
    kb.keysRotateRight = []
    kb.onTurn = null
    if (this.firstPersonView) {
      kb.alongYaw = null
    } else {
      // iso pitch would walk you into the ground if we used the full view matrix
      kb.alongYaw = () => this.camera.rotation.y
    }
  }

  addControls(camera: PlayerCamera) {
    camera.attachControl(this.canvas, true)
    this.mouseLookAttached = true // camera.attachControl attaches mouse; lock handler may detach
    this.addLockListener()

    this.addKeyboardControls(camera)
    this.addGamepadControls(camera)

    this.desktopClicks = this.desktopClicks.bind(this)
    this.scene.onPointerObservable.add(this.desktopClicks, undefined, true)

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  dispose() {
    if (this.lockListener) document.removeEventListener('pointerlockchange', this.lockListener)
    this.scene.onPointerObservable.removeCallback(this.desktopClicks)
  }

  onPointerLockChange() {
    const cam = this.camera
    if (!cam?.inputs) return

    const canvas = this.scene.getEngine().getRenderingCanvas()
    const locked = document.pointerLockElement === canvas

    // sidebar buttons are unclickable while locked - fade them out of the way
    document.body.classList.toggle('walking', locked)

    this.scene.preventDefaultOnPointerDown = locked
    this.scene.preventDefaultOnPointerUp = locked

    const mouse = cam.inputs.attached['mouse'] as BABYLON.FreeCameraMouseInput | undefined
    if (locked) {
      // Babylon FreeCameraMouseInput stacks observers on every attach; never attach twice
      if (!this.mouseLookAttached) {
        mouse?.attachControl(true)
        this.mouseLookAttached = true
      }
    } else {
      // feature editor open: keep drag-look attached so off-object drags still look around.
      // face drag / gizmos claim their pointer-downs on prepointer, so they never fight the camera.
      const editorOpen = !!(window.ui?.state?.editor || window.ui?.state?.feature)
      if (this.mouseLookAttached && !editorOpen) {
        mouse?.detachControl()
        this.mouseLookAttached = false
      }
      this.resetControls()
    }
  }

  // unlocked entry into the editor (tree click) — locked entry keeps the input from lock time
  attachDragLook() {
    const mouse = this.camera.inputs?.attached['mouse'] as BABYLON.FreeCameraMouseInput | undefined
    if (mouse && !this.mouseLookAttached) {
      mouse.attachControl(true)
      this.mouseLookAttached = true
    }
  }

  addLockListener() {
    this.lockListener = () => this.onPointerLockChange()
    document.addEventListener('pointerlockchange', this.lockListener)
  }

  resetControls() {
    this.shiftKey = false
    this.ctrlKey = false
    this.walk()
    this.keyboardInput?.reset()
  }

  desktopClicks(eventData: BABYLON.PointerInfo, eventState: BABYLON.EventState) {
    // selected feature: leave pickInfo in world space for gizmos / face-drag.
    // otherwise convert to persona space for click handlers below.
    const authoring = !!window.ui?.state?.feature
    if (!authoring && eventData.pickInfo?.pickedPoint) {
      eventData.pickInfo.pickedPoint = eventData.pickInfo.pickedPoint.subtract(this.worldOffset.position)
    }

    const btn = eventData.event.button

    if (eventData.type === BABYLON.PointerEventTypes.POINTERDOWN && btn === 0 && !hasPointerLock() && !eventData.event.shiftKey) {
      // selected feature: free mouse for face-drag / gizmos. don't steal into pointer lock.
      if (!authoring) {
        this.nerfClick = true
        this.requestPointerLock()?.catch(() => {})
        return
      }
    }

    switch (eventData.type) {
      case BABYLON.PointerEventTypes.POINTERWHEEL:
        this.handlePointerWheel((<any>eventData.event).deltaY)
        break

      case BABYLON.PointerEventTypes.POINTERTAP:
        if (btn === 1) {
          this.togglePerspective()
          break
        }
        if (btn === 2) {
          eventData.event.preventDefault()
          const pick = hasPointerLock() ? this.pickAtReticule() : eventData.pickInfo
          this.handleContextClick(pick)
          eventState.skipNextObservers = true
          break
        }
        if (btn === 0 && eventData.event.shiftKey && !hasPointerLock()) {
          const feature = featureFromPick(eventData.pickInfo)
          if (feature?.parcel?.canEdit) {
            window.ui?.editShiftSelect(feature)
            eventState.skipNextObservers = true
          }
          break
        }
        // edit aside open (inspector or tree-only browse): empty click fully closes the sidebar
        const editPaneOpen = !hasPointerLock() && !window.ui?.state?.dragging && (uiPane.value === 'edit' || window.ui?.state?.pane === 'edit' || !!window.ui?.state?.editor || !!window.ui?.state?.feature)
        if (btn === 0 && editPaneOpen) {
          const selected = window.ui?.state?.feature
          // compare roots — right-click selects the group root, raw pick returns the child
          const picked = featureFromPick(eventData.pickInfo)?.mostParent
          // same-object tap (incl. the click that ends a drag) keeps selection; empty / other exits
          if (selected && picked?.uuid === selected.uuid) break
          if (picked?.parcel?.canEdit) {
            picked.openEditor()
          } else {
            // click away: leave edit mode entirely — sidebar goes away, pointer lock back
            window.ui?.closeWithPointerLock()
          }
          eventState.skipNextObservers = true
          break
        }
        if (btn === 0 && hasPointerLock() && !window.ui?.activeTool) {
          if (isFastviewBlocking()) {
            const fv = document.querySelector('dialog.fastview, dialog.nft-view.-out') as any
            fv?.dismiss?.()
            eventState.skipNextObservers = true
            break
          }
          if (this.nerfClick) {
            this.nerfClick = false
          } else {
            this.lockedLeftClick(this.pickAtReticule())
          }
          eventState.skipNextObservers = true
        }
        break

      case BABYLON.PointerEventTypes.POINTERMOVE:
        const pick = hasPointerLock() ? this.pickAtView(undefined, undefined, false, (m) => this.reticuleHighlightPredicate(m)) : eventData.pickInfo
        const feature = featureFromPick(pick)
        const distance = pick?.distance || Infinity
        this.setActiveReticule(!!feature?.isInteract && distance < this.MAX_PICK_DISTANCE)
        this.updateMuteHint(eventData)
    }
  }

  private muteHintEl: HTMLDivElement | null = null
  private updateMuteHint(eventData: BABYLON.PointerInfo) {
    const avatar = eventData.pickInfo?.pickedMesh?.metadata?.avatar as { uuid: string } | undefined
    const vc = window.persona?.voiceChat
    const near = (eventData.pickInfo?.distance ?? Infinity) < this.MAX_PICK_DISTANCE
    const show = !!avatar && !!vc?.on && avatar.uuid !== window.persona?.uuid && near
    if (!show) {
      if (this.muteHintEl) this.muteHintEl.style.opacity = '0'
      return
    }
    if (!this.muteHintEl) {
      const el = document.createElement('div')
      Object.assign(el.style, {
        position: 'fixed',
        zIndex: '999998',
        pointerEvents: 'none',
        padding: '4px 8px',
        background: 'rgba(13,13,13,0.85)',
        color: '#f5f5f0',
        fontFamily: '"Source Code Pro", monospace',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        transform: 'translate(-50%, -140%)',
        transition: 'opacity 0.12s',
        opacity: '0',
      })
      document.body.appendChild(el)
      this.muteHintEl = el
    }
    this.muteHintEl.textContent = vc!.mutedUuids.has(avatar!.uuid) ? 'right-click to unmute' : 'right-click to mute'
    this.muteHintEl.style.left = `${eventData.event.clientX}px`
    this.muteHintEl.style.top = `${eventData.event.clientY}px`
    this.muteHintEl.style.opacity = '1'
  }

  handlePointerWheel(delta: number) {
    if (this.firstPersonView) {
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

  addKeyboardControls(camera: BABYLON.Camera) {
    this.keyboardInput = new LocaleKeyboardMoveInput({
      keysUp: ['ArrowUp', 'KeyW'],
      keysUpward: this.flying ? ['PageUp'] : [],
      keysDown: ['ArrowDown', 'KeyS'],
      keysDownward: this.flying ? ['PageDown', 'KeyV'] : [],
      keysLeft: ['ArrowLeft', 'KeyA'],
      keysRight: ['ArrowRight', 'KeyD'],
    })
    this.bindKeys()
    camera.inputs.add(this.keyboardInput)

    this.canvas.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return

      this.shiftKey = e.shiftKey
      this.ctrlKey = e.ctrlKey || e.metaKey

      const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'KeyV']
      if (moveKeys.includes(e.code)) {
        // walking with a free cursor fades the sidebar too; hover brings it back
        document.body.classList.add('walking')
      }

      const congaCancelKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      if (this.congaTarget && congaCancelKeys.includes(e.code)) {
        this.stopConga()
      }

      if (e.code === 'Space') this.camera.jump()

      if (e.code === 'KeyE') {
        // stop bubble so document KeyE (edit feature) does not toggle us straight back out / open the editor
        if (this.vehicleFeature || this.findNearbyDriveable()) {
          e.stopPropagation()
          this.tryEnterVehicle()
        }
      }
      if (e.code === 'KeyT' && this.vehicleFeature) {
        e.stopPropagation()
        // quarter turns: 4 taps covers every megavox facing, not just front/back
        this.nudgeDriveFacing(Math.PI / 2)
      }
      if (e.code === 'KeyG' && this.vehicleFeature) {
        // stop bubble so document KeyG (emote pane) does not open over us
        e.stopPropagation()
        this.toggleSeatMode()
      }
      if (e.code === 'Escape' && this.vehicleFeature) {
        e.stopPropagation()
        this.stopVehicle()
      }

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.run()
      } else if (this.running && !this.shiftKey) {
        this.walk()
      }

      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        if (hasPointerLock() && location.pathname === '/parcels' && new URLSearchParams(location.search).get('parcel')) {
          app.emit(AppEvent.Exploring)
        }
      }
    })

    window.addEventListener('keyup', (e) => {
      this.shiftKey = e.shiftKey
      this.ctrlKey = e.ctrlKey || e.metaKey

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.walk()
      }
    })
  }

  addGamepadControls(camera: PlayerCamera) {
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
    document.querySelectorAll('.pointer-lock-close').forEach((element) => {
      unmountComponentAtNode(element)
      element.remove()
    })
    ;(window as any).engine?.setBlur?.(false)

    // don't focus() before lock — steals the user gesture, forces a second click
    const maybePromise: unknown = this.canvas.requestPointerLock()
    if (maybePromise instanceof Promise) {
      return maybePromise.then((v) => {
        this.canvas.focus()
        return v
      })
    }

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
        this.canvas.focus()
        resolve(e)
      }

      document.addEventListener('pointerlockerror', pointerLockError)
      document.addEventListener('pointerlockchange', pointerLockSuccess)
    })
  }
}
