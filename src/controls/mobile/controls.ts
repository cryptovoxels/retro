import Controls, { CAMERA_DISTANCE } from '../controls'
import DpadControls, { toggleDpadControls } from '../../ui/mobile/dpad'
import PlayerCamera from '../utils/player-camera'
import { decodeCoords } from '../../../common/helpers/utils'
import { getCoordsFromURL } from '../../utils/helpers'
import { createFirstPersonCamera } from '../utils/fps-camera'
export default class MobileControls extends Controls {
  shiftKey = false
  dpad: DpadControls | null = null
  btnCameraView: HTMLElement | null = null
  btnToggleFly: HTMLElement | null = null
  btnDrive: HTMLButtonElement | null = null

  constructor(scene: BABYLON.Scene, canvas: HTMLCanvasElement) {
    super(scene, canvas)
    this.defaultSpeed = 0.25
  }

  createCamera() {
    const coords = decodeCoords(getCoordsFromURL())
    const camera = createFirstPersonCamera(this.scene, coords)
    this.resetWorldOffset(coords.position)

    if (coords && coords.rotation) {
      camera['rotation'].y = coords?.rotation.y || 0
    }

    // improve controls
    camera.angularSensibility = 200
    camera.inertia = 0.01
    return camera
  }

  addControls(camera: PlayerCamera) {
    camera.attachControl(this.canvas, true)

    // Mobile overlays
    toggleDpadControls(this).then((dpad) => {
      this.dpad = dpad
    })

    // Hide / show reticule
    this.scene.registerBeforeRender(() => {
      for (const ch of this.reticuleChannels) ch.visibility = 0
      this.walking()
    })

    // by now the UX buttons for the mobile should be in the DOM so we can grab them
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.btnCameraView = document.querySelector('.mobile-controls-container > .camera-view-button')
      this.btnToggleFly = document.querySelector('.mobile-controls-container > .fly-button')
      this.btnDrive = document.querySelector('.mobile-controls-container > .drive-button')
      this.refreshMobileDriveChrome()
    })
  }

  override refreshMobileDriveChrome() {
    if (!this.btnDrive) return
    if (this.vehicleFeature) {
      this.btnDrive.style.display = ''
      this.btnDrive.textContent = 'Exit'
    } else if (this.vehicleNearby && !this.vehicleNearby.driverUuid) {
      this.btnDrive.style.display = ''
      this.btnDrive.textContent = 'Drive'
    } else {
      this.btnDrive.style.display = 'none'
    }
  }

  override setFlying(value: boolean) {
    super.setFlying(value)
    if (!!this.btnToggleFly) {
      this.btnToggleFly.innerHTML = this.flying ? 'Walk' : 'Fly'
    }
  }

  override enterThirdPerson(startingDistance = CAMERA_DISTANCE) {
    const entered = super.enterThirdPerson(startingDistance)
    if (entered && !!this.btnCameraView) {
      this.btnCameraView.innerHTML = 'Zoom'
    }
    return entered
  }

  override enterFirstPerson() {
    const entered = super.enterFirstPerson()
    if (entered && !!this.btnCameraView) {
      this.btnCameraView.innerHTML = 'Zoom'
    }
    return entered
  }

  walking() {
    // while driving, dpad feeds updateVehicle via this.direction - do not also walk the camera
    if (this.vehicleFeature) return

    const camera = this.camera as PlayerCamera & {
      _localDirection: BABYLON.Vector3
      _transformedDirection: BABYLON.Vector3
      _cameraTransformMatrix: BABYLON.Matrix
    }

    if (this.direction) {
      camera._localDirection.copyFrom(this.direction)
    }

    camera.getViewMatrix().invertToRef(camera._cameraTransformMatrix)
    BABYLON.Vector3.TransformNormalToRef(camera._localDirection, camera._cameraTransformMatrix, camera._transformedDirection)
    camera.cameraDirection.addInPlace(camera._transformedDirection)
  }

  enableMovement() {
    this.camera.speed = this.defaultSpeed
    this.movementEnabled = true
  }
}

/**
 * Handle virtual keyboard on small devices.
 */
const initialHeight = window.visualViewport?.height ?? window.innerHeight

let orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'

export function resetMobileViewportLayout() {
  // body's only height is the inline 100% set at boot. Clearing it collapses body
  // to auto, the absolute canvas (height 100%) goes to 0, and the world turns black.
  document.body.style.height = '100%'
}

let skipMobileCanvasRefreshUntil = 0

let settleResizeTimer = 0

// native confirms and permission sheets: block global visibility resize until handoff settles
export function holdMobileCanvasRefresh(ms: number) {
  skipMobileCanvasRefreshUntil = Date.now() + ms
}

// share sheet / app switch can leave the babylon canvas blank until resize runs again
export function refreshMobileCanvasAfterReturn() {
  if (Date.now() < skipMobileCanvasRefreshUntil) return
  resetMobileViewportLayout()
  requestAnimationFrame(() => window.engine?.resize())
}

export function viewportChangeHandler() {
  // Check if viewPort change is caused by a rotation (dont do anything)
  if (!window.matchMedia(`(orientation: ${orientation})`).matches) {
    orientation = window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
    resetMobileViewportLayout()
    return
  }

  const viewHeight = window.visualViewport?.height ?? window.innerHeight
  const keyboardUp = viewHeight < initialHeight - 30
  const input = document.activeElement
  const typing = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement

  const inChat = typing && input instanceof HTMLElement && !!input.closest('.chat')

  // chat pins itself to the visual viewport - stretching body here pans the world
  // out from under the input. other fields still get the stretch.
  if (keyboardUp && typing && !inChat) {
    document.body.style.height = initialHeight + 'px'
  } else {
    resetMobileViewportLayout()
  }

  // iOS fires a stream of resize events while the keyboard animates. Resizing the
  // engine mid-animation wipes the canvas to black until the next painted frame
  // (which Safari delays during the animation), so wait for the viewport to settle
  // and resize once inside a frame. skip while chat is focused - that resize is
  // the world jumping.
  window.clearTimeout(settleResizeTimer)
  if (inChat) return
  settleResizeTimer = window.setTimeout(() => requestAnimationFrame(() => window.engine?.resize()), 150)
}
