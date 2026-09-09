import Controls from './controls'
import { wantsGateway } from '../../common/helpers/detector'
import { getWorldGroundState, worldSceneEvents, worldSceneLoaded } from '../init/world-scene'

let worldTerrain: { groundMeshes: BABYLON.AbstractMesh[] } | undefined

export function setWorldTerrainForXR(terrain: { groundMeshes: BABYLON.AbstractMesh[] } | undefined) {
  worldTerrain = terrain
}

const MOVE_SPEED = 3.5
const STICK_DEADZONE = 0.15
const SITTING_EYE = 1.1 // head above the seat point while driving

export default class XROverlay {
  webXR: BABYLON.WebXRDefaultExperience | null = null
  xrTeleportation: BABYLON.WebXRMotionControllerTeleportation | null = null
  teleportableMeshes: Set<BABYLON.AbstractMesh> = new Set()
  scene: BABYLON.Scene
  canvas: HTMLCanvasElement
  controls: Controls
  /** left thumbstick, raw -1..1 */
  private stick = { x: 0, y: 0 }
  private flyUp = false
  private flyDown = false
  /** floors may not be meshed when we enter XR - retry the height snap until the ray hits */
  private floorSnapPending = false
  private wasDriving = false

  constructor(scene: BABYLON.Scene, canvas: HTMLCanvasElement, controls: Controls) {
    this.scene = scene
    this.canvas = canvas
    this.controls = controls
  }

  get helper() {
    return this.webXR!.baseExperience
  }

  attachWorldScene() {
    worldSceneEvents.addEventListener('parcel-collider-added', (e) => this.addTeleportMesh(e.detail))
    worldSceneEvents.addEventListener('parcel-collider-removed', (e) => this.removeTeleportMesh(e.detail))
    if (worldSceneLoaded()) getWorldGroundState().addStateObserver('loaded', this.onGroundLoaded)
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
      try {
        if (state !== BABYLON.WebXRState.IN_XR) return
        // parcels/terrain may still be loading - tick retries until the ray hits (fixes spawning stuck at y=0)
        this.floorSnapPending = !this.resetXRFloorHeight(camera.position)
      } catch (e) {
        console.log('error', e)
      }
    })

    const featuresManager = this.webXR.baseExperience.featuresManager

    this.xrTeleportation = featuresManager.enableFeature(BABYLON.WebXRFeatureName.TELEPORTATION, 'stable', {
      xrInput: this.webXR.input,
      floorMeshes: Array.from(this.teleportableMeshes),
      // right stick teleports; left stick is free locomotion (see tick)
      forceHandedness: 'right',
    }) as BABYLON.WebXRMotionControllerTeleportation

    featuresManager.disableFeature(BABYLON.WebXRFeatureName.POINTER_SELECTION)

    if (multiview) {
      featureManager.enableFeature(BABYLON.WebXRFeatureName.LAYERS, 'stable', { preferMultiviewOnInit: true }, true, false)
    }

    this.xrTeleportation.rotationEnabled = false
    this.xrTeleportation.parabolicRayEnabled = true

    this.watchControllers()
    this.scene.onBeforeRenderObservable.add(this.tick)
  }

  private watchControllers() {
    this.webXR!.input.onControllerAddedObservable.add((controller) => {
      controller.onMotionControllerInitObservable.add((mc) => {
        if (mc.handedness === 'left') {
          const stick = mc.getComponent('xr-standard-thumbstick')
          stick?.onAxisValueChangedObservable.add((v) => {
            this.stick.x = v.x
            this.stick.y = v.y
          })
          // X enters / exits a nearby ride
          mc.getComponent('x-button')?.onButtonStateChangedObservable.add((c) => {
            if (c.pressed) this.controls.tryEnterVehicle()
          })
        } else {
          // right hand keeps teleport; A/B fly up/down (climb/dive while driving a flyable)
          mc.getComponent('a-button')?.onButtonStateChangedObservable.add((c) => (this.flyUp = c.pressed))
          mc.getComponent('b-button')?.onButtonStateChangedObservable.add((c) => (this.flyDown = c.pressed))
        }
      })
    })
  }

  private tick = () => {
    if (!this.webXR || this.helper.state !== BABYLON.WebXRState.IN_XR) return
    const camera = this.helper.camera
    const dt = this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60

    if (this.floorSnapPending && this.resetXRFloorHeight(camera.position)) this.floorSnapPending = false

    const driving = !!this.controls.vehicleFeature
    if (driving !== this.wasDriving) {
      this.wasDriving = driving
      // teleporting off the seat mid-drive is nonsense
      try {
        if (driving) this.helper.featuresManager.detachFeature(BABYLON.WebXRFeatureName.TELEPORTATION)
        else this.helper.featuresManager.attachFeature(BABYLON.WebXRFeatureName.TELEPORTATION)
      } catch {}
    }

    const dead = (v: number) => (Math.abs(v) > STICK_DEADZONE ? v : 0)
    const x = dead(this.stick.x)
    const y = dead(this.stick.y)
    const fly = (this.flyUp ? 1 : 0) - (this.flyDown ? 1 : 0)

    if (driving) {
      // stick forward pushes -y; updateVehicle does the rest
      this.controls.vehicleSteer.forward = -y
      this.controls.vehicleSteer.turn = x
      this.controls.vehicleSteer.climb = fly
      // wear the seat: updateVehicle parks the body on the seat point each frame
      const b = this.controls.body.position
      camera.position.set(b.x, b.y + SITTING_EYE, b.z)
      return
    }

    if (!x && !y && !fly) return
    // free locomotion relative to head yaw; A/B fly. noclip on purpose - teleport is the grounded option
    const yaw = camera.rotationQuaternion.toEulerAngles().y
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    camera.position.x += (x * cos - y * sin) * MOVE_SPEED * dt
    camera.position.z += (-x * sin - y * cos) * MOVE_SPEED * dt
    camera.position.y += fly * MOVE_SPEED * dt
  }

  onGroundLoaded = () => {
    worldTerrain?.groundMeshes.forEach((mesh) => this.addTeleportMesh(mesh))
  }

  resetXRFloorHeight(positionInWorld: BABYLON.Vector3): boolean {
    if (!this.webXR) return false

    const camera = this.webXR.baseExperience.camera
    const pickResult = this.scene.pickWithRay(new BABYLON.Ray(positionInWorld, new BABYLON.Vector3(0, -1, 0), 5), (e) => this.teleportableMeshes.has(e))
    if (!pickResult?.hit || !pickResult.pickedPoint) return false
    camera.position.y = pickResult.pickedPoint.y + camera.realWorldHeight
    return true
  }

  addTeleportMesh(mesh: BABYLON.AbstractMesh) {
    this.teleportableMeshes.add(mesh)
    if (this.xrTeleportation) this.xrTeleportation.addFloorMesh(mesh)
  }

  removeTeleportMesh(mesh: BABYLON.AbstractMesh) {
    this.teleportableMeshes.delete(mesh)
    if (this.xrTeleportation) this.xrTeleportation.removeFloorMesh(mesh)
  }
}
