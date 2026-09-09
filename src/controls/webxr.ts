import Controls from './controls'
import { EYE } from './utils/player-body'
import { xrHeight } from '../utils/camera'
import { wantsGateway } from '../../common/helpers/detector'
import { getWorldTerrain, worldSceneEvents, worldSceneLoaded } from '../init/world-scene'

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
  private starting = false
  private entered = false
  private slowWalk = true
  private walkHintUntil = 0
  private angles = BABYLON.Vector3.Zero()
  /** left thumbstick, raw -1..1 */
  private stick = { x: 0, y: 0 }
  private flyUp = false
  private flyDown = false
  /** floors may not be meshed when we enter XR - retry the height snap until the ray hits */
  private floorSnapPending = false
  private wasDriving = false
  private seatPosition = BABYLON.Vector3.Zero()
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
    try {
      this.slowWalk = localStorage.getItem('xrWalkSpeed') !== 'fast'
    } catch {}
  }

  get helper() {
    return this.webXR!.baseExperience
  }

  attachWorldScene() {
    worldSceneEvents.addEventListener('parcel-collider-added', (e) => this.addTeleportMesh(e.detail))
    worldSceneEvents.addEventListener('parcel-collider-removed', (e) => this.removeTeleportMesh(e.detail))
    worldSceneEvents.addEventListener('ground-loaded', this.onGroundLoaded)
    if (worldSceneLoaded()) this.onGroundLoaded()
  }

  async start() {
    if (this.starting || (this.webXR && this.helper.state !== BABYLON.WebXRState.NOT_IN_XR)) return
    this.starting = true
    try {
      if (!this.webXR) await this.setupXR()
      if (!this.webXR?.baseExperience) return
      if (wantsGateway()) {
        try {
          await this.helper.enterXRAsync('immersive-ar', 'local-floor', this.webXR.renderTarget)
        } catch {
          await this.helper.enterXRAsync('immersive-vr', 'local-floor', this.webXR.renderTarget)
        }
      } else {
        await this.helper.enterXRAsync('immersive-vr', 'local-floor', this.webXR.renderTarget)
      }
    } catch (e) {
      console.error('Unable to enter VR', e)
    } finally {
      this.starting = false
    }
  }

  private async setupXR() {
    this.webXR = await this.scene.createDefaultXRExperienceAsync({
      outputCanvasOptions: { canvasOptions: { framebufferScaleFactor: 0.5 } },
      disableDefaultUI: true,
      disableTeleportation: true,
      disableNearInteraction: true,
      pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true, maxPointerDistance: 20, disableScenePointerVectorUpdate: true },
    })

    if (!this.webXR || !this.webXR.baseExperience) {
      console.error('Error initializing webxr')
      this.webXR = null
      return
    }

    const camera = this.webXR.baseExperience.camera

    this.helper.onInitialXRPoseSetObservable.add(() => {
      if (!wantsGateway()) camera.position.y = this.controls.body.position.y - EYE
    })
    const leaveDialog = () => {
      if (this.helper.state === BABYLON.WebXRState.IN_XR) void this.helper.exitXRAsync().catch(() => {})
    }
    window.addEventListener('dialogopen', leaveDialog)
    this.scene.onDisposeObservable.addOnce(() => window.removeEventListener('dialogopen', leaveDialog))

    this.webXR.baseExperience.onStateChangedObservable.add((state) => {
      this.floorSnapPending = state === BABYLON.WebXRState.IN_XR
      if (state === BABYLON.WebXRState.IN_XR) {
        this.entered = true
        this.walkHintUntil = Date.now() + 8000
        this.controls.body.resetMotion()
        this.controls.flying = false
        this.syncBody()
        this.controls.resetFloor()
        try {
          this.helper.sessionManager.fixedFoveation = 0.5
        } catch {}
        return
      }
      this.resetInput()
      this.clearHighlight()
      this.setHint('')
      if (state === BABYLON.WebXRState.NOT_IN_XR && this.entered) {
        this.entered = false
        if (this.controls.vehicleFeature) this.controls.stopVehicle()
        // PlayerCamera.place() reads the body, so Babylon's camera-only exit copy is lost.
        this.syncBody()
        this.controls.camera.rotation.copyFrom(camera.rotationQuaternion.toEulerAngles())
        this.controls.camera.place()
        this.controls.resetFloor()
        this.wasDriving = false
        if (this.xrTeleportation) this.xrTeleportation.teleportationEnabled = true
      }
    })

    const featuresManager = this.webXR.baseExperience.featuresManager

    this.xrTeleportation = featuresManager.enableFeature(BABYLON.WebXRFeatureName.TELEPORTATION, 'stable', {
      xrInput: this.webXR.input,
      floorMeshes: Array.from(this.teleportableMeshes),
      // right stick teleports; left stick is free locomotion (see tick)
      forceHandedness: 'right',
    }) as BABYLON.WebXRMotionControllerTeleportation

    this.xrTeleportation.setSelectionFeature(this.webXR.pointerSelection)
    this.controls.xrSelection = this.webXR.pointerSelection

    this.xrTeleportation.rotationEnabled = false
    this.xrTeleportation.parabolicRayEnabled = true

    // aiming the arc at a free ride makes it glow; landing on it seats you
    this.xrTeleportation.onTargetMeshPositionUpdatedObservable.add((pick) => this.aimUpdate(pick))
    // The shipped Babylon 6.11.2 emits this on the camera, not the teleport feature.
    camera.onAfterCameraTeleport.add(() => this.teleportLanded())

    this.watchControllers()
    this.scene.onBeforeRenderObservable.add(this.tick)
  }

  private watchControllers() {
    const input = this.webXR!.input
    const bindController = (controller: BABYLON.WebXRInputSource) => {
      const bind = (mc: BABYLON.WebXRAbstractMotionController) => {
        if (mc.handedness === 'left') {
          const stick = mc.getComponent('xr-standard-thumbstick')
          stick?.onAxisValueChangedObservable.add((v) => {
            this.stick.x = v.x
            this.stick.y = v.y
          })
          // X enters / exits a nearby ride
          mc.getComponent('x-button')?.onButtonStateChangedObservable.add((c) => {
            if (c.changes.pressed?.current && this.helper.state === BABYLON.WebXRState.IN_XR) this.controls.tryEnterVehicle()
          })
          mc.getComponent('y-button')?.onButtonStateChangedObservable.add((c) => {
            if (!c.changes.pressed?.current || this.helper.state !== BABYLON.WebXRState.IN_XR) return
            this.slowWalk = !this.slowWalk
            this.walkHintUntil = Date.now() + 5000
            try {
              localStorage.setItem('xrWalkSpeed', this.slowWalk ? 'slow' : 'fast')
            } catch {}
          })
        } else {
          // right hand keeps teleport; A/B fly up/down (climb/dive while driving a flyable)
          mc.getComponent('a-button')?.onButtonStateChangedObservable.add((c) => (this.flyUp = c.pressed))
          mc.getComponent('b-button')?.onButtonStateChangedObservable.add((c) => (this.flyDown = c.pressed))
        }
      }
      if (controller.motionController) bind(controller.motionController)
      else controller.onMotionControllerInitObservable.addOnce(bind)
    }
    input.controllers.forEach(bindController)
    input.onControllerAddedObservable.add(bindController)
    input.onControllerRemovedObservable.add(() => this.resetInput())
  }

  private resetInput() {
    this.controls.body.resetMotion()
    this.stick.x = this.stick.y = 0
    this.flyUp = this.flyDown = false
    this.controls.vehicleSteer.forward = this.controls.vehicleSteer.turn = this.controls.vehicleSteer.climb = 0
  }

  private syncBody() {
    const camera = this.helper.camera
    const p = this.controls.body.position
    p.x = camera.position.x
    p.y = camera.position.y + EYE - xrHeight(camera)
    p.z = camera.position.z
  }

  private tick = () => {
    if (!this.webXR || this.helper.state !== BABYLON.WebXRState.IN_XR) return
    const camera = this.helper.camera
    const height = xrHeight(camera)
    const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60)

    if (this.floorSnapPending && this.resetXRFloorHeight(camera.position)) this.floorSnapPending = false

    const driving = !!this.controls.vehicleFeature
    if (driving !== this.wasDriving) {
      this.wasDriving = driving
      this.clearHighlight()
      if (driving) {
        this.driveHintUntil = Date.now() + DRIVE_HINT_MS
        const b = this.controls.body.position
        this.seatPosition.set(b.x, b.y, b.z)
        camera.position.set(b.x, b.y + SITTING_EYE, b.z)
      }
      // Keep right-stick snap turns available while seated.
      if (this.xrTeleportation) this.xrTeleportation.teleportationEnabled = !driving
    }

    const now = Date.now()
    if (now - this.rideScanAt > 500) {
      this.rideScanAt = now
      this.scanRides(camera.position)
    }
    // aim observable only fires while aiming - drop a stale glow once the arc is gone
    if (this.highlighted && now - this.highlightAt > 300) this.clearHighlight()
    this.updateHint(camera, driving, now)

    const x = Math.abs(this.stick.x) > STICK_DEADZONE ? this.stick.x : 0
    const y = Math.abs(this.stick.y) > STICK_DEADZONE ? this.stick.y : 0
    const fly = (this.flyUp ? 1 : 0) - (this.flyDown ? 1 : 0)

    if (driving) {
      // stick forward pushes -y; updateVehicle does the rest
      this.controls.vehicleSteer.forward = -y
      this.controls.vehicleSteer.turn = x
      this.controls.vehicleSteer.climb = fly
      // Move with the seat without undoing tracked leaning or standing.
      const b = this.controls.body.position
      camera.position.x += b.x - this.seatPosition.x
      camera.position.y += b.y - this.seatPosition.y
      camera.position.z += b.z - this.seatPosition.z
      this.seatPosition.set(b.x, b.y, b.z)
      return
    }

    this.syncBody()
    const body = this.controls.body
    if (!this.controls.movementEnabled) return
    if (fly) this.controls.flying = true
    body.flying = this.controls.flying
    body.noclip = false
    if (body.flying || this.floorSnapPending) body.gravity = false
    camera.rotationQuaternion.toEulerAnglesToRef(this.angles)
    const yaw = this.angles.y
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const length = Math.max(1, Math.hypot(x, y))
    this.controls.move.set((x * cos - y * sin) / length, fly, (-x * sin - y * cos) / length)
    const speed = body.speed
    body.speed = this.slowWalk ? 1.5 : MOVE_SPEED
    body.step(this.controls.move, dt, true)
    body.speed = speed
    this.controls.move.setAll(0)
    camera.position.set(body.position.x, body.position.y - EYE + height, body.position.z)
  }

  onGroundLoaded = () => {
    // island ground meshes are the streets - without these you can only teleport onto parcels
    getWorldTerrain()?.groundMeshes.forEach((mesh) => this.addTeleportMesh(mesh))
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

  private teleportLanded() {
    this.floorSnapPending = false
    this.controls.body.resetMotion()
    if (this.controls.vehicleFeature) this.controls.stopVehicle()
    this.controls.flying = false
    this.syncBody()
    this.controls.resetFloor()
    const ride = this.highlighted ? this.rideMeshes.get(this.highlighted) : null
    this.clearHighlight()
    if (!this.controls.vehicleFeature && this.rideFree(ride)) this.controls.enterVehicle(ride)
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
    let text = ''
    if (driving) {
      if (now >= this.driveHintUntil) {
        this.setHint('')
        return
      }
      const car = this.controls.vehicleFeature as Ride
      text = car?.isFlyable ? 'stick drives - A/B climb - X hops out' : 'stick drives - X hops out'
    } else if (now < this.walkHintUntil) {
      text = this.slowWalk ? 'slow walk - Y faster - trigger interacts' : 'fast walk - Y slower - trigger interacts'
    }
    if (text) {
      this.setHint(text)
      camera.rotationQuaternion.toEulerAnglesToRef(this.angles)
      const yaw = this.angles.y
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
    const ray = new BABYLON.Ray(positionInWorld.clone(), BABYLON.Vector3.Down(), 5)
    const floor = (mesh: BABYLON.AbstractMesh) => this.teleportableMeshes.has(mesh)
    let pickResult = this.scene.pickWithRay(ray, floor)
    if (!pickResult?.hit) {
      // At y=0 the street is above the headset; a downward ray alone never recovers.
      ray.origin.y += 2
      ray.length += 2
      pickResult = this.scene.pickWithRay(ray, floor)
    }
    if (!pickResult?.hit || !pickResult.pickedPoint) return false
    camera.position.y = pickResult.pickedPoint.y + xrHeight(camera)
    return true
  }

  addTeleportMesh(mesh: BABYLON.AbstractMesh) {
    if (this.teleportableMeshes.has(mesh)) return
    this.teleportableMeshes.add(mesh)
    mesh.onDisposeObservable.addOnce(() => this.removeTeleportMesh(mesh))
    if (this.xrTeleportation) this.xrTeleportation.addFloorMesh(mesh)
  }

  removeTeleportMesh(mesh: BABYLON.AbstractMesh) {
    this.teleportableMeshes.delete(mesh)
    if (this.xrTeleportation) this.xrTeleportation.removeFloorMesh(mesh)
  }
}
