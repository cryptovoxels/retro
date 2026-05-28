import Controls, { CAMERA_DISTANCE } from '../controls'
import DpadControls, { toggleDpadControls } from '../../ui/mobile/dpad'
import OurCamera from '../utils/our-camera'
import { decodeCoords } from '../../../common/helpers/utils'
import { getCoordsFromURL } from '../../utils/helpers'
import { createFirstPersonCamera } from '../utils/fps-camera'
export default class MobileControls extends Controls {
  shiftKey = false
  direction: BABYLON.Vector3 = new BABYLON.Vector3()
  dpad: DpadControls | null = null
  btnCameraView: HTMLElement | null = null
  btnToggleFly: HTMLElement | null = null

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

  addControls(camera: OurCamera | BABYLON.ArcRotateCamera) {
    camera.attachControl(this.canvas, true)

    // Mobile overlays
    toggleDpadControls(this).then((dpad) => {
      this.dpad = dpad
    })

    // Hide / show reticule
    this.scene.registerBeforeRender(() => {
      this.reticuleNormal.visibility = 0
      this.reticuleHighlight.visibility = 0
      this.walking()
    })

    // by now the UX buttons for the mobile should be in the DOM so we can grab them
    this.scene.onAfterRenderObservable.addOnce(() => {
      this.btnCameraView = document.querySelector('.mobile-controls-container > .camera-view-button')
      this.btnToggleFly = document.querySelector('.mobile-controls-container > .fly-button')
    })
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
    const camera = this.camera as OurCamera & {
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
  document.body.style.height = ''
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

  // Only stretch body while the keyboard is up and a field is focused. Otherwise reset
  // or the canvas + dpad scroll off-screen when send blurs the input.
  if (keyboardUp && typing) {
    document.body.style.height = initialHeight + 'px'
  } else {
    resetMobileViewportLayout()
  }

  window.engine?.resize()
}
