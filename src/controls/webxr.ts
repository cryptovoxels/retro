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
const RIDE_SCAN_RANGE = 25 // rides inside this become teleport targets
const RIDE_HINT_RANGE = 8 // floating "teleport onto it" hint distance
const DRIVE_HINT_MS = 5000

type Ride = import('../features/vox-model').Ride

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
  /** nearby rides that are teleport targets - land on one and you're driving */
  private rideMeshes = new Map<BABYLON.AbstractMesh, Ride>()
  private rideScanAt = 0
  /** ride glowing under the teleport arc */
  private highlighted: BABYLON.AbstractMesh | null = null
  private highlightAt = 0
  private highlightColor = BABYLON.Color3.Green()
  private hintMesh: BABYLON.Mesh | null = null
  private hintTexture: BABYLON.DynamicTexture | null = null
  private hintText = ''
  private driveHintUntil = 0

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

    // aiming the arc at a free ride makes it glow; landing on it seats you
    this.xrTeleportation.onTargetMeshPositionUpdatedObservable.add((pick) => this.aimUpdate(pick))
    this.xrTeleportation.onAfterCameraTeleport.add((pos) => this.teleportLanded(pos))

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
      this.clearHighlight()
      if (driving) this.driveHintUntil = Date.now() + DRIVE_HINT_MS
      // teleporting off the seat mid-drive is nonsense
      try {
        if (driving) this.helper.featuresManager.detachFeature(BABYLON.WebXRFeatureName.TELEPORTATION)
        else this.helper.featuresManager.attachFeature(BABYLON.WebXRFeatureName.TELEPORTATION)
      } catch {}
    }

    const now = Date.now()
    if (now - this.rideScanAt > 500) {
      this.rideScanAt = now
      this.scanRides(camera.position)
    }
    // aim observable only fires while aiming - drop a stale glow once the arc is gone
    if (this.highlighted && now - this.highlightAt > 300) this.clearHighlight()
    this.updateHint(camera, driving, now)

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

  // --- ride entry: teleport onto it to drive ---

  /** keep nearby rides registered as teleport targets */
  private scanRides(camPos: BABYLON.Vector3) {
    const parcels = this.controls.grid?.parcels
    if (!parcels) return
    const seen = new Set<BABYLON.AbstractMesh>()
    for (const parcel of parcels.values()) {
      for (const f of parcel.featuresList || []) {
        if (f?.type !== 'ride') continue
        const ride = f as Ride
        if (!ride.mesh || ride.disposed) continue
        const p = ride.absolutePosition
        if (!p || BABYLON.Vector3.DistanceSquared(camPos, p) > RIDE_SCAN_RANGE * RIDE_SCAN_RANGE) continue
        seen.add(ride.mesh)
        if (!this.rideMeshes.has(ride.mesh)) {
          this.rideMeshes.set(ride.mesh, ride)
          this.xrTeleportation?.addFloorMesh(ride.mesh)
        }
      }
    }
    for (const mesh of this.rideMeshes.keys()) {
      if (seen.has(mesh)) continue
      this.rideMeshes.delete(mesh)
      this.xrTeleportation?.removeFloorMesh(mesh)
      if (this.highlighted === mesh) this.clearHighlight()
    }
  }

  private rideFree(ride: Ride | null | undefined): ride is Ride {
    return !!ride && !ride.disposed && (!ride.driverUuid || ride.driverUuid === this.controls.persona.uuid)
  }

  private aimUpdate(pick: BABYLON.PickingInfo) {
    const mesh = pick?.pickedMesh
    const ride = mesh ? (this.rideMeshes.get(mesh) ?? this.rideMeshes.get(mesh.parent as BABYLON.AbstractMesh)) : null
    const target = this.rideFree(ride) && !this.controls.vehicleFeature ? ride.mesh : null
    if (this.highlighted !== target) this.clearHighlight()
    if (!target) return
    target.renderOverlay = true
    target.overlayColor = this.highlightColor
    this.highlighted = target
    this.highlightAt = Date.now()
  }

  private clearHighlight() {
    if (this.highlighted) this.highlighted.renderOverlay = false
    this.highlighted = null
  }

  private teleportLanded(pos: BABYLON.Vector3) {
    if (this.controls.vehicleFeature) return
    for (const ride of this.rideMeshes.values()) {
      if (!this.rideFree(ride)) continue
      const bb = ride.boundingBox
      if (!bb) continue
      const closest = BABYLON.Vector3.Clamp(pos, bb.minimumWorld, bb.maximumWorld)
      if (BABYLON.Vector3.DistanceSquared(pos, closest) > 1.5 * 1.5) continue
      this.controls.enterVehicle(ride)
      return
    }
  }

  // --- in-world hints (the DOM hint never renders in a headset) ---

  private setHint(text: string) {
    if (text === this.hintText) return
    this.hintText = text
    if (!text) {
      this.hintMesh?.setEnabled(false)
      return
    }
    if (!this.hintMesh) {
      this.hintTexture = new BABYLON.DynamicTexture('xr-hint', { width: 1024, height: 96 }, this.scene, false)
      this.hintTexture.hasAlpha = true
      const mat = new BABYLON.StandardMaterial('xr-hint', this.scene)
      mat.emissiveTexture = this.hintTexture
      mat.opacityTexture = this.hintTexture
      mat.disableLighting = true
      mat.backFaceCulling = false
      this.hintMesh = BABYLON.MeshBuilder.CreatePlane('xr-hint', { width: 2.4, height: 0.225 }, this.scene)
      this.hintMesh.material = mat
      this.hintMesh.billboardMode = BABYLON.AbstractMesh.BILLBOARDMODE_ALL
      this.hintMesh.isPickable = false
    }
    const ctx = this.hintTexture!.getContext()
    ctx.clearRect(0, 0, 1024, 96)
    this.hintTexture!.drawText(text, null, 64, 'bold 44px monospace', '#f5f5f0', null, true)
    this.hintMesh.setEnabled(true)
  }

  private updateHint(camera: BABYLON.WebXRCamera, driving: boolean, now: number) {
    if (driving) {
      if (now >= this.driveHintUntil) {
        this.setHint('')
        return
      }
      const car = this.controls.vehicleFeature as Ride
      this.setHint(car?.isFlyable ? 'stick drives - A/B climb - X hops out' : 'stick drives - X hops out')
      const yaw = camera.rotationQuaternion.toEulerAngles().y
      this.hintMesh!.position.set(camera.position.x + Math.sin(yaw) * 1.6, camera.position.y - 0.15, camera.position.z + Math.cos(yaw) * 1.6)
      return
    }
    // nearest free ride close by gets a floating "how do I drive this" line
    let best: Ride | null = null
    let bestD = RIDE_HINT_RANGE * RIDE_HINT_RANGE
    for (const ride of this.rideMeshes.values()) {
      if (!this.rideFree(ride)) continue
      const p = ride.absolutePosition
      if (!p) continue
      const d = BABYLON.Vector3.DistanceSquared(camera.position, p)
      if (d < bestD) {
        bestD = d
        best = ride
      }
    }
    const bb = best?.boundingBox
    if (!bb) {
      this.setHint('')
      return
    }
    this.setHint('teleport onto it to drive')
    this.hintMesh!.position.set(bb.centerWorld.x, bb.maximumWorld.y + 0.45, bb.centerWorld.z)
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
