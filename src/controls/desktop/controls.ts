import Controls, { featureFromPick, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from '../controls'

import OurCamera from '../utils/our-camera'
import { LocaleKeyboardMoveInput } from '../utils/locale-keyboard-move-input'
import { clamp } from 'lodash'
import { unmountComponentAtNode } from 'preact/compat'
import { createFirstPersonCamera } from '../utils/fps-camera'
import { decodeCoordsFromURL } from '../../utils/helpers'
import { hasPointerLock } from '../../../common/helpers/ui-helpers'
import { app, AppEvent } from '../../../web/src/state'
const POINTER_WHEEL_MULTIPLIER = 0.001
export default class DesktopControls extends Controls {
  keyboardInput?: LocaleKeyboardMoveInput
  private lockListener?: () => void

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

  addControls(camera: OurCamera) {
    camera.attachControl(this.canvas, true)
    this.addLockListener()

    this.addKeyboardControls(camera)
    this.addGamepadControls(camera)

    this.desktopClicks = this.desktopClicks.bind(this)
    this.scene.onPointerObservable.add(this.desktopClicks, undefined, true)

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.startSpawnGroundCheck()
  }

  private startSpawnGroundCheck() {
    const start = Date.now()
    const id = setInterval(() => {
      if (Date.now() - start > 10_000) {
        clearInterval(id)
        return
      }
      if (!this.persona) return
      const origin = this.persona.position.add(this.worldOffset.position)
      const ray = new BABYLON.Ray(origin, new BABYLON.Vector3(0, -1, 0), 2)
      const hit = this.scene.pickWithRay(ray, (e) => e.checkCollisions, true)
      if (hit?.hit) {
        this.setFlying(false)
        clearInterval(id)
      }
    }, 100)
  }

  dispose() {
    if (this.lockListener) document.removeEventListener('pointerlockchange', this.lockListener)
    this.scene.onPointerObservable.removeCallback(this.desktopClicks)
  }

  onPointerLockChange() {
    const cam = this.camera as OurCamera | undefined
    if (!cam?.inputs) return

    const canvas = this.scene.getEngine().getRenderingCanvas()
    const locked = document.pointerLockElement === canvas

    this.scene.preventDefaultOnPointerDown = locked
    this.scene.preventDefaultOnPointerUp = locked

    const mouse = cam.inputs.attached['mouse'] as BABYLON.FreeCameraMouseInput | undefined
    if (locked) {
      mouse?.attachControl(true)
    } else {
      mouse?.detachControl()
      this.resetControls()
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
    if (eventData.pickInfo?.pickedPoint) {
      eventData.pickInfo.pickedPoint = eventData.pickInfo.pickedPoint.subtract(this.worldOffset.position)
    }

    const btn = eventData.event.button

    if (eventData.type === BABYLON.PointerEventTypes.POINTERDOWN && btn === 0 && !hasPointerLock() && !eventData.event.shiftKey) {
      window.ui?.clearAllExplore()
      this.requestPointerLock()?.catch(() => {})
      return
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
        if (btn === 0 && hasPointerLock() && !window.ui?.activeTool) {
          this.lockedLeftClick(this.pickAtReticule())
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
      keysUpward: ['PageUp', 'Space'],
      keysDown: ['ArrowDown', 'KeyS'],
      keysDownward: ['PageDown', 'KeyV'],
      keysLeft: ['ArrowLeft', 'KeyA'],
      keysRight: ['ArrowRight', 'KeyD'],
    })
    camera.inputs.add(this.keyboardInput)

    this.canvas.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return

      this.shiftKey = e.shiftKey
      this.ctrlKey = e.ctrlKey || e.metaKey

      const congaCancelKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
      if (this.congaTarget && congaCancelKeys.includes(e.code)) {
        this.stopConga()
      }

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.run()
      } else if (this.running && !this.shiftKey) {
        this.walk()
      }

      if ((e.code === 'KeyS' || e.code === 'ArrowDown') && !this.firstPersonView) {
        this.facingForward = false
      }

      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        this.facingForward = true
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

    this.canvas.focus()

    const maybePromise: unknown = this.canvas.requestPointerLock()
    if (maybePromise instanceof Promise) {
      return maybePromise
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
        resolve(e)
      }

      document.addEventListener('pointerlockerror', pointerLockError)
      document.addEventListener('pointerlockchange', pointerLockSuccess)
    })
  }
}
