import { Environment } from '../enviroments/environment'
import Controls from './controls'
import { WorldEnvironment } from '../enviroments/world-environment'
import { wantsGateway } from '../../common/helpers/detector'

export default class XROverlay {
  webXR: BABYLON.WebXRDefaultExperience | null = null
  xrTeleportation: BABYLON.WebXRMotionControllerTeleportation | null = null
  teleportableMeshes: Set<BABYLON.AbstractMesh> = new Set()
  scene: BABYLON.Scene
  canvas: HTMLCanvasElement
  controls: Controls

  constructor(scene: BABYLON.Scene, canvas: HTMLCanvasElement, controls: Controls) {
    this.scene = scene
    this.canvas = canvas
    this.controls = controls
  }

  get helper() {
    return this.webXR!.baseExperience
  }

  attachEnvironment(environment: Environment) {
    environment.addEventListener('parcel-collider-added', (e) => this.addTeleportMesh(e.detail))
    environment.addEventListener('parcel-collider-removed', (e) => this.removeTeleportMesh(e.detail))

    environment.groundStateObservable.addStateObserver('loaded', this.onGroundLoaded)
  }

  async start() {
    const multiview = false

    this.webXR = await this.scene.createDefaultXRExperienceAsync({
      outputCanvasOptions: { canvasOptions: { framebufferScaleFactor: 0.5 } },
      disableDefaultUI: true,
    })

    if (!this.webXR || !this.webXR.baseExperience) {
      console.error('Error initializing webxr')
      return
    }

    const xrOpts = multiview ? { optionalFeatures: ['layers'] } : {}
    if (wantsGateway()) {
      try {
        await this.helper.enterXRAsync('immersive-ar', 'local-floor', undefined, xrOpts)
      } catch {
        await this.helper.enterXRAsync('immersive-vr', 'local-floor', undefined, xrOpts)
      }
    } else {
      await this.helper.enterXRAsync('immersive-vr', 'local-floor', undefined, xrOpts)
    }
    const featureManager = this.helper.featuresManager

    const camera = this.webXR.baseExperience.camera

    this.webXR.baseExperience.onStateChangedObservable.add((state) => {
      // console.log(`XR State Change to: ${state}`)

      try {
        if (state !== BABYLON.WebXRState.IN_XR) {
          return
        }

        this.resetXRFloorHeight(camera.position)
      } catch (e) {
        console.log('error', e)
      }
    })

    const featuresManager = this.webXR.baseExperience.featuresManager

    this.xrTeleportation = featuresManager.enableFeature(BABYLON.WebXRFeatureName.TELEPORTATION, 'stable', {
      xrInput: this.webXR.input,
      floorMeshes: Array.from(this.teleportableMeshes),
    }) as BABYLON.WebXRMotionControllerTeleportation

    // disable the pointer as it is unused currently and just adds overhead (avoid picking)
    featuresManager.disableFeature(BABYLON.WebXRFeatureName.POINTER_SELECTION)

    if (multiview) {
      featureManager.enableFeature(BABYLON.WebXRFeatureName.LAYERS, 'stable', { preferMultiviewOnInit: true }, true, false)
    }

    this.xrTeleportation.rotationEnabled = false
    this.xrTeleportation.parabolicRayEnabled = true
  }

  onGroundLoaded = () => {
    // add the world colliders to the teleportation
    if (window.environment instanceof WorldEnvironment) {
      if (window.environment.terrain) {
        window.environment.terrain.groundMeshes.forEach((mesh) => this.addTeleportMesh(mesh))
      }
    }
  }

  resetXRFloorHeight(positionInWorld: BABYLON.Vector3) {
    if (!this.webXR) {
      return
    }

    const camera = this.webXR.baseExperience.camera

    const pickResult = this.scene.pickWithRay(new BABYLON.Ray(positionInWorld.add(this.controls.worldOffset.position), new BABYLON.Vector3(0, -1, 0), 5), (e) => e.checkCollisions)
    if (!pickResult?.hit || !pickResult.pickedPoint) {
      return
    }

    const pickPositionInWorld = pickResult.pickedPoint.subtract(this.controls.worldOffset.position)
    camera.position.y = pickPositionInWorld.y + camera.realWorldHeight
  }

  addTeleportMesh(mesh: BABYLON.AbstractMesh) {
    if (!mesh.checkCollisions) return

    this.teleportableMeshes.add(mesh)
    if (this.xrTeleportation) {
      this.xrTeleportation.addFloorMesh(mesh)
    }
  }

  removeTeleportMesh(mesh: BABYLON.AbstractMesh) {
    if (!mesh.checkCollisions) return

    this.teleportableMeshes.delete(mesh)
    if (this.xrTeleportation) {
      this.xrTeleportation.removeFloorMesh(mesh)
    }
  }
}
