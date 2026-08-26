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
import { pointerOverGizmo } from '../../tools/gizmos'
import { Camera, SceneContext } from '@babylonjs/lite'

const POINTER_WHEEL_MULTIPLIER = 0.001
// BJS PointerEventTypes stand-ins for desktopClicks
const PTR_DOWN = 1
const PTR_UP = 2
const PTR_MOVE = 4
const PTR_WHEEL = 8
const PTR_TAP = 32
export default class DesktopControls extends Controls {
  keyboardInput?: LocaleKeyboardMoveInput
  private lockListener?: () => void
  private nerfClick = false
  private mouseLookAttached = false
  private hadPointerLock = false
  private canvasHooked = false
  private onCanvasMouseDown = (e: MouseEvent) => this.desktopClicks({ type: PTR_DOWN, event: e, pickInfo: null }, { skipNextObservers: false })
  private onCanvasMouseUp = (e: MouseEvent) => this.desktopClicks({ type: PTR_UP, event: e, pickInfo: null }, { skipNextObservers: false })
  private onCanvasMouseMove = (e: MouseEvent) => this.desktopClicks({ type: PTR_MOVE, event: e, pickInfo: null }, { skipNextObservers: false })
  private onCanvasWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.desktopClicks({ type: PTR_WHEEL, event: e, pickInfo: null }, { skipNextObservers: false })
  }

  constructor(scene: SceneContext, canvas: HTMLCanvasElement) {
    super(scene, canvas)

    // todo(lite): scene.skipPointerUpPicking / skipPointerDownPicking

    this.addLockListener()
  }

  createCamera() {
    const coords = decodeCoordsFromURL()
    const camera = createFirstPersonCamera(this.scene, coords)

    if (coords && coords.rotation) {
      camera['rotation'].y = coords?.rotation.y || 0
    }

    return camera
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
    this.mouseLookAttached = false

    this.addKeyboardControls(camera)
    this.addGamepadControls(camera)

    this.hookCanvas()
  }

  /** Canvas moves into .client-canvas after boot; bind clicks on the live element. */
  hookCanvas() {
    const canvas = (document.querySelector('canvas#renderCanvas') ?? this.canvas) as HTMLCanvasElement
    if (!canvas || this.canvasHooked) return
    this.canvasHooked = true
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0

    this.desktopClicks = this.desktopClicks.bind(this)
    canvas.addEventListener('mousedown', this.onCanvasMouseDown)
    canvas.addEventListener('mouseup', this.onCanvasMouseUp)
    canvas.addEventListener('mousemove', this.onCanvasMouseMove)
    canvas.addEventListener('wheel', this.onCanvasWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  dispose() {
    if (this.lockListener) document.removeEventListener('pointerlockchange', this.lockListener)
    const canvas = (document.querySelector('canvas#renderCanvas') ?? this.canvas) as HTMLCanvasElement
    canvas.removeEventListener('mousedown', this.onCanvasMouseDown)
    canvas.removeEventListener('mouseup', this.onCanvasMouseUp)
    canvas.removeEventListener('mousemove', this.onCanvasMouseMove)
    canvas.removeEventListener('wheel', this.onCanvasWheel)
  }

  onPointerLockChange() {
    const cam = this.camera
    if (!cam?.inputs) return

    const canvas = (document.querySelector('canvas#renderCanvas') ?? this.scene.getEngine().getRenderingCanvas()) as HTMLCanvasElement
    const locked = document.pointerLockElement === canvas

    // sidebar buttons are unclickable while locked - fade them out of the way
    document.body.classList.toggle('walking', locked)

    this.scene.preventDefaultOnPointerDown = locked
    this.scene.preventDefaultOnPointerUp = locked

    const mouse = cam.inputs.attached['mouse'] as any | undefined
    if (locked) {
      this.hadPointerLock = true
      if (!this.mouseLookAttached) {
        mouse?.attachControl(true)
        this.mouseLookAttached = true
      }
    } else if (this.hadPointerLock) {
      this.hadPointerLock = false
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
    const mouse = this.camera.inputs?.attached['mouse'] as any | undefined
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

  desktopClicks(eventData: any, eventState: any) {
    const authoring = !!window.ui?.state?.feature

    const btn = eventData.event.button

    if (eventData.type === PTR_DOWN && btn === 0 && !hasPointerLock() && !eventData.event.shiftKey) {
      const editMode = window.ui?.featureTool?.selection?.mode === 'edit' && window.ui?.activeTool === window.ui?.featureTool
      if (editMode) {
        if (pointerOverGizmo(this.scene)) return
        window.ui?.closeWithPointerLock()
        return
      }
      // ActionGui (Drive / try-on / guestbook): lock mid-press moves the cursor to
      // screen center so POINTERUP never lands on the button
      if (!authoring) {
        const meshName = eventData.pickInfo?.pickedMesh?.name || ''
        if (meshName.startsWith('feature/basicGui/')) return
        this.nerfClick = true
        this.requestPointerLock()?.catch(() => {})
        return
      }
    }

    switch (eventData.type) {
      case PTR_WHEEL:
        this.handlePointerWheel((<any>eventData.event).deltaY)
        break

      case PTR_TAP:
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
          const picked = featureFromPick(eventData.pickInfo)
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

      case PTR_MOVE:
        const pick = hasPointerLock() ? this.pickAtView(undefined, undefined, false, (m) => this.reticuleHighlightPredicate(m)) : eventData.pickInfo
        const feature = featureFromPick(pick)
        const distance = pick?.distance || Infinity
        this.setActiveReticule(!!feature?.isInteract && distance < this.MAX_PICK_DISTANCE)
        this.updateMuteHint(eventData)
    }
  }

  private muteHintEl: HTMLDivElement | null = null
  private updateMuteHint(eventData: any) {
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

  addKeyboardControls(camera: Camera) {
    this.keyboardInput = new LocaleKeyboardMoveInput({
      keysUp: ['ArrowUp', 'KeyW'],
      keysDown: ['ArrowDown', 'KeyS'],
      keysLeft: ['ArrowLeft', 'KeyA'],
      keysRight: ['ArrowRight', 'KeyD'],
    })
    this.keyboardInput.move = this.move
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

      if (e.code === 'Space') this.body.jump()

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

  addGamepadControls(_camera: PlayerCamera) {
    // todo(lite): BABYLON gamepad input + GamepadManager
  }

  onGamepadButton(button: string, pressed: boolean) {
    if (button === 'LeftStick') {
      if (pressed) this.toggleRun()
    } else if (button === 'Cross' || button === 'A') {
      if (pressed) {
        this.body.jump()
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
    if ((false /* todo(lite): gamepad instanceof BABYLON.DualShockPad */)) {
      return (undefined as any /* todo(lite): BABYLON.DualShockButton[button] */)
    } else if ((false /* todo(lite): gamepad instanceof BABYLON.Xbox360Pad */)) {
      return (undefined as any /* todo(lite): BABYLON.Xbox360Button[button] */)
    }
  }

  requestPointerLock() {
    document.querySelectorAll('.pointer-lock-close').forEach((element) => {
      unmountComponentAtNode(element)
      element.remove()
    })
    ;(window as any).engine?.setBlur?.(false)

    // don't focus() before lock — steals the user gesture, forces a second click
    const canvas = (document.querySelector('canvas#renderCanvas') ?? this.canvas) as HTMLCanvasElement
    const maybePromise: unknown = canvas.requestPointerLock()
    if (maybePromise instanceof Promise) {
      return maybePromise.then((v) => {
        canvas.focus()
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
        canvas.focus()
        resolve(e)
      }

      document.addEventListener('pointerlockerror', pointerLockError)
      document.addEventListener('pointerlockchange', pointerLockSuccess)
    })
  }
}
