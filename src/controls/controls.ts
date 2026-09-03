import { isDesktop, isMobile, wantsNoUI } from '../../common/helpers/detector'
import { User } from '../user'
import { encodeCoords } from '../../common/helpers/utils'
import type Grid from '../grid'
import Connector from '../connector'
import PlayerCamera from './utils/player-camera'
import PlayerBody, { WALK, RUN } from './utils/player-body'
import { isLoaded } from '../utils/loading-done'
import Feature, { MeshExtended } from '../features/feature'
import Avatar from '../avatar'
import { cameraPosition, cameraRotation } from '../utils/camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'
import { IControls } from './iControls'
import { Animations } from '../avatar-animations'

export const CAMERA_DISTANCE = isMobile() ? 2.5 : 1.5
export const MIN_CAMERA_DISTANCE = 0.5
export const MAX_CAMERA_DISTANCE = 10
const ISO_DISTANCE = 4
const ISO_PITCH = 0.75 // look down at the avatar, isometric-ish
const CAMERA_EASE_OUT = 1.4
const SWIM_LEVEL = -2

/** Meters behind the person in front (each hop of the snake). */
const CONGA_FOLLOW_DISTANCE = 1.35
/** Extra depth when the line has stopped so the cluster is not on top of each other. */
const CONGA_STOPPED_EXTRA_BACK = 0.28
/** Max side offset per player when stopped (meters), scaled by group blend. */
const CONGA_LATERAL_PER_SLOT = 0.48

/** Stable -3..3 slot from uuid so each follower picks a different side offset when grouped. */
function congaLateralSlot(uuid: string): number {
  let h = 2166136261
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (((h % 7) + 7) % 7) - 3
}

const WALK_TO_RUN_EASE = new BABYLON.SineEase()
WALK_TO_RUN_EASE.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEIN)
const RUN_TO_WALK_EASE = new BABYLON.SineEase()
RUN_TO_WALK_EASE.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT)

/**
 * Get the next value of easing the current number to the target number
 * CAMERA_EASE_OUT defines the speed
 */
const easeCamera = (current: number, target: number, easingSpeed = CAMERA_EASE_OUT) => {
  if (target === current) {
    return current
  }

  if (target <= current) {
    // Close, jump straight to target
    if (current - target <= 0.01) {
      return target
    }
    // Target is smaller, divide gap by constant to ease into target value
    return target + (current - target) / easingSpeed
  } else {
    // Target is bigger, multiply by constant
    const candidate = Math.max(current, 0.1) * easingSpeed
    if (candidate >= target) {
      return target
    } else {
      return candidate
    }
  }
}

/**
 * The minimum camera distance for the player's avatar to be displayed to themselves
 */
const MIN_CAMERA_DISTANCE_FOR_SELF_AVATAR = 0.2

export default abstract class Controls implements IControls {
  camera: PlayerCamera = undefined!
  body: PlayerBody = undefined!
  /** unitless direction; inputs write, body.step scales by speed * dt */
  move = BABYLON.Vector3.Zero()
  hasGamepad = false
  flying = false
  swimming = false
  cameraDistance = 0
  targetCameraDistance: number = CAMERA_DISTANCE
  reticuleRoot: BABYLON.TransformNode
  reticuleChannels: BABYLON.Mesh[]
  reticuleActive = false
  private chromaAmount = 0
  private reticuleSpinT = 0
  user: User
  defaultSpeed = WALK
  runSpeed = RUN
  running = false
  movementEnabled = true
  shiftKey = false
  ctrlKey = false
  firstPersonView = true
  walkRunAnimation: BABYLON.Animatable | null = null
  /** mobile dpad sets this; also used as drive steer while in a vehicle */
  direction: BABYLON.Vector3 = new BABYLON.Vector3()

  congaTarget: Avatar | null = null
  /** Leader's inConga can arrive a few ticks late over multiplayer. */
  private congaSyncGraceUntil = 0
  private congaSawLeaderInConga = false
  /** Track movement of person in front; when still, blend toward arc / group layout. */
  private congaTargetPrevPos: BABYLON.Vector3 | null = null
  private congaGroupBlend = 0
  /** Flying mode before joining conga; restored in stopConga. */
  private congaFlyingRestore: boolean | null = null
  private wasAirborne = false

  // --- ride ---
  vehicleFeature: import('../features/vox-model').Ride | null = null
  private vehicleHoverY = 0
  private vehicleLastDryPos: BABYLON.Vector3 | null = null
  private vehicleLastDryRot: BABYLON.Vector3 | null = null
  private vehicleWasFirstPerson = true
  private vehicleFlyingRestore: boolean | null = null
  private vehicleLastStateAt = 0
  private vehicleNearbyAt = 0
  private vehicleHintEl: HTMLDivElement | null = null
  vehicleNearby: import('../features/vox-model').Ride | null = null
  /** mobile / shared: -1..1 forward and turn while driving */
  vehicleSteer = { forward: 0, turn: 0 }
  /** visitor-only facing nudge when they can't save driveYawOffset */
  private vehicleFacingNudge = 0
  /** working seat offset while seated (local to ride); flushed to driveSeatOffset when editable */
  private vehicleSeatOffset: [number, number, number] = [0, 1.2, 0]
  /** G toggles: drive keys move the seat instead of the car (owners only) */
  private vehicleSeatMode = false
  private vehicleSeatLocal = new BABYLON.Vector3()
  private vehicleSeatWorld = new BABYLON.Vector3()
  /** document-level WASD - Babylon camera keyboard often misses keys while speed is 0 / no canvas focus */
  private driveHeld = new Set<string>()
  private onDriveKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.driveHeld.add(e.code)
  }
  private onDriveKeyUp = (e: KeyboardEvent) => {
    this.driveHeld.delete(e.code)
  }

  MAX_PICK_DISTANCE = 20
  audioContext: AudioContext = undefined!
  private cameraZoomed = false
  // parcels under our feet still waiting on colliders. [] = waiting on the worker, null = floor is solid
  private floorWait: number[] | null = null

  constructor(
    protected scene: BABYLON.Scene,
    protected canvas: HTMLCanvasElement,
  ) {
    this.user = window.user

    // Add input system specific controls and cameras
    const camera = this.createCamera()
    this.addControls(camera)

    this.camera = camera
    this.scene.activeCamera = camera

    this.body = new PlayerBody()
    Object.assign(this.body.position, { x: camera.position.x, y: camera.position.y, z: camera.position.z })
    camera.body = this.body
    camera.place()

    // Enable feature clicking
    this.scene.onPointerObservable.add(this.featureClickHandler.bind(this))

    document.addEventListener('keydown', this.onDriveKeyDown)
    document.addEventListener('keyup', this.onDriveKeyUp)

    const reticule = generateReticule(scene)
    this.reticuleRoot = reticule.root
    this.reticuleChannels = reticule.channels
    this.reticuleRoot.parent = this.camera

    if (isDesktop() && !wantsNoUI()) {
      this.scene.onBeforeRenderObservable.add(() => {
        this.tickReticuleSpin()
      })
    }

    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000 || 1 / 60

      // stock babylon gamepad writes cameraDirection as stick * dt; fold into unitless move
      if (this.camera.cameraDirection.lengthSquared() > 0) {
        this.move.addInPlace(this.camera.cameraDirection.scaleInPlace(1 / dt))
        this.camera.cameraDirection.setAll(0)
      }

      if (this.floorWait?.length && this.floorWait.every((id) => this.grid?.getByID(id)?.physicsRegistered)) this.floorWait = null
      this.body.flying = this.flying
      this.body.gravity = !this.flying && !this.floorWait
      this.body.step(this.move, dt)
      this.move.setAll(0)
      this.updateConga()
      this.updateVehicle()
      // let persona update its position from the body
      this.persona.update(cameraPosition(this.scene), cameraRotation(this.scene), this)
      this.swimming = this.persona.isSwimming(SWIM_LEVEL) ?? this.swimming
      this.firstOrThirdPersonAdjustment()
    })

    // Seriously limit pick checking on mouse moves
    this.defaultPointerMovePredicate = this.defaultPointerMovePredicate.bind(this)
    this.scene.pointerMovePredicate = this.defaultPointerMovePredicate
  }

  get persona() {
    return window.persona
  }

  get grid(): Grid | undefined {
    // fixme decoupling
    return window.grid
  }

  get showSelfAvatar(): boolean {
    return !this.persona.firstPersonView && this.cameraDistance >= MIN_CAMERA_DISTANCE_FOR_SELF_AVATAR
  }

  get connector(): Connector {
    return window.connector
  }

  toggleZoom() {
    const animateFov = (target: number) => {
      const camera = this.scene.activeCamera
      if (!camera) {
        return
      }
      this.cameraZoomed = !this.cameraZoomed
      BABYLON.Animation.CreateAndStartAnimation('fov anim', camera, 'fov', 120, 15, camera.fov, target, 0)
    }

    if (!this.cameraZoomed) {
      this.enterFirstPerson()
      animateFov(0.45)
    } else {
      animateFov(window.fov.value)
    }
  }

  // Ben's reticule pick (1c4cec3) used scene.pick() without pointerMovePredicate, so build-mode
  // picks hit avatar/features instead of voxel colliders. Tools pass useMovePredicate=true;
  // context menu / locked click use unpredicated center ray when no tool is active.
  pickAtView(x?: number, y?: number, useMovePredicate = false, predicateOverride?: (mesh: BABYLON.AbstractMesh) => boolean): BABYLON.PickingInfo | null {
    const cam = this.camera
    if (!cam) return null

    const predicate = predicateOverride ?? (useMovePredicate ? this.scene.pointerMovePredicate : undefined)
    const engine = this.scene.getEngine()
    // scene.pick wants CSS pixels; getRenderWidth is device pixels. Convert via the hardware
    // scaling level (set to 1/dpr) or the reticule center is off by dpr on hi-dpi screens.
    const scaling = engine.getHardwareScalingLevel()
    const px = x ?? (engine.getRenderWidth() * scaling) / 2
    const py = y ?? (engine.getRenderHeight() * scaling) / 2
    const pick = this.scene.pick(px, py, predicate, false, cam)

    return pick ?? null
  }

  // Highlight only: isInteract features + voxel-field occlusion. Skips vox/megavox/cube/polytext.
  reticuleHighlightPredicate(mesh: BABYLON.AbstractMesh): boolean {
    if (!mesh.isPickable || !mesh.isVisible || !mesh.isEnabled()) return false
    if (mesh.name.startsWith('voxel-field/opaque') || mesh.name.startsWith('voxelizer/')) return true
    const f = (mesh as MeshExtended).feature ?? (mesh.parent as MeshExtended | null)?.feature
    return !!f?.isInteract
  }

  pickAtReticule() {
    return this.pickAtView(undefined, undefined, !!window.ui?.activeTool)
  }

  pickForPointer(pickInfo?: BABYLON.PickingInfo | null) {
    if (hasPointerLock()) {
      return this.pickAtView(undefined, undefined, true)
    }
    if (!this.firstPersonView) {
      return this.pickAtView(this.scene.pointerX, this.scene.pointerY, true) ?? pickInfo ?? null
    }
    return pickInfo ?? null
  }

  lockedLeftClick(pickInfo?: BABYLON.PickingInfo | null) {
    if (!pickInfo) return
    if (window.ui?.visible || window.ui?.activeTool) return
    const distance = pickInfo.distance || Infinity
    const parcel = (pickInfo.pickedMesh as MeshExtended | undefined)?.feature?.parcel
    if (distance > this.MAX_PICK_DISTANCE && !parcel?.canEdit) return
    const handler = (pickInfo.pickedMesh as MeshExtended | undefined)?.cvOnLeftClick
    if (handler) handler(pickInfo)
  }

  featureClickHandler(eventData: BABYLON.PointerInfo) {
    if (isDesktop()) return
    if (eventData.event.button === 0 && eventData.type === BABYLON.PointerEventTypes.POINTERPICK) {
      this.lockedLeftClick(eventData.pickInfo)
    }
  }

  handleContextClick(pickInfo?: BABYLON.PickingInfo | null) {
    if (!pickInfo) return

    const picked = featureFromPick(pickInfo)
    if (picked?.onContextClick()) return

    if (pickInfo.pickedMesh && pickInfo.pickedMesh.metadata?.avatar instanceof Avatar) {
      const avatar: Avatar = pickInfo.pickedMesh.metadata.avatar
      avatar.onContextClick()
      return
    }

    if (pickInfo.pickedPoint && this.grid) {
      // can't easily get the parcel for a given mesh so instead we look up parcel nearest to click
      // fallback to currentParcel if no nearby parcels (used for spaces and when editing before fully loaded)
      const parcel = this.grid.getNearest(6, pickInfo.pickedPoint)[0] || this.grid.currentOrNearestParcel()
      if (parcel && parcel.onContextClick()) return
    }
  }

  firstOrThirdPersonAdjustment() {
    if (this.firstPersonView) {
      this.cameraDistance = easeCamera(this.cameraDistance, 0)
      if (this.cameraDistance <= 0) this.persona.firstPersonView = true
    } else {
      this.cameraDistance = easeCamera(this.cameraDistance, this.targetCameraDistance)
    }
    this.camera.distance = this.cameraDistance
    this.camera.place()
    this.showSelfAvatar ? this.persona.avatar?.show() : this.persona.avatar?.hide()
  }

  abstract createCamera(): PlayerCamera

  abstract addControls(camera: PlayerCamera): void

  enableMovement() {
    this.body.speed = this.running ? this.runSpeed : this.defaultSpeed
    this.movementEnabled = true
  }

  disableMovement() {
    this.body.speed = 0
    this.movementEnabled = false
  }

  toggleRun() {
    if (this.running) {
      this.walk()
    } else {
      this.run()
    }
  }

  run() {
    this.running = true

    if (this.movementEnabled) {
      const fps = 60
      const duration = 10
      this.walkRunAnimation?.stop()
      this.walkRunAnimation = BABYLON.Animation.CreateAndStartAnimation('walk-to-run', this.body, 'speed', fps, duration, this.body.speed, this.runSpeed, undefined, WALK_TO_RUN_EASE, undefined, this.scene)
      this.walkRunAnimation!.loopAnimation = false
    }
  }

  walk() {
    this.running = false

    if (this.movementEnabled) {
      const fps = 60
      const duration = 13
      const target = this.defaultSpeed
      this.walkRunAnimation?.stop()
      this.walkRunAnimation = BABYLON.Animation.CreateAndStartAnimation('walk-to-run', this.body, 'speed', fps, duration, this.body.speed, target, undefined, WALK_TO_RUN_EASE, undefined, this.scene)
      this.walkRunAnimation!.loopAnimation = false
    }
  }

  setActiveReticule(active = false) {
    this.reticuleActive = active
  }

  private tickReticuleSpin() {
    const dt = this.scene.getEngine().getDeltaTime() / 1000
    const target = this.reticuleActive ? 1 : 0
    if (this.chromaAmount !== target) {
      const step = dt / 0.2
      if (this.chromaAmount < target) this.chromaAmount = Math.min(target, this.chromaAmount + step)
      else this.chromaAmount = Math.max(target, this.chromaAmount - step)
    }

    const shown = hasPointerLock() || this.hasGamepad
    const baseVis = shown ? (this.firstPersonView ? 1 : 0.2) : 0
    const vis = baseVis * (0.5 + 0.5 * this.chromaAmount)
    const scale = 0.5 + 0.5 * this.chromaAmount

    if (this.chromaAmount === 0 && !this.reticuleActive) {
      for (const ch of this.reticuleChannels) {
        ch.visibility = vis
        ch.scaling.setAll(scale)
        ch.rotation.z = 0
        ch.position.x = 0
        ch.position.y = 0
      }
      this.reticuleSpinT = 0
      return
    }

    this.reticuleSpinT += dt
    const t = this.reticuleSpinT
    const a = this.chromaAmount
    const orbit = 0.0009 * a
    const [r, g, b] = this.reticuleChannels
    r.visibility = vis
    g.visibility = vis
    b.visibility = vis
    r.scaling.setAll(scale)
    g.scaling.setAll(scale)
    b.scaling.setAll(scale)
    r.rotation.z = t * 2.6 * a
    g.rotation.z = (t * 3.4 + 0.7) * a
    b.rotation.z = (t * 1.9 - 0.7) * a
    r.position.x = Math.cos(t * 4.1) * orbit
    r.position.y = Math.sin(t * 4.1) * orbit
    g.position.x = Math.cos(t * 5.2 + 2.1) * orbit
    g.position.y = Math.sin(t * 5.2 + 2.1) * orbit
    b.position.x = Math.cos(t * 3.3 + 4.2) * orbit
    b.position.y = Math.sin(t * 3.3 + 4.2) * orbit
  }

  setFlying(value: boolean) {
    this.flying = value
    console.log('setFlying', value)
  }

  toggleFlying() {
    this.setFlying(!this.flying)
  }

  // called on spawn and teleport: hold gravity until the parcels here have colliders
  resetFloor() {
    if (!this.grid) return
    this.floorWait = []
    const p = this.body.position
    this.grid.queryParcelsAtPosition(new BABYLON.Vector3(p.x, p.y, p.z)).then((ids) => (this.floorWait = ids.length ? ids : null))
  }

  setNoclip(on: boolean) {
    this.body.noclip = on
  }

  togglePerspective() {
    if (this.firstPersonView) {
      this.enterThirdPerson(ISO_DISTANCE)
      this.snapIso()
    } else {
      this.enterFirstPerson()
    }
  }

  enterThirdPerson(startingDistance = CAMERA_DISTANCE) {
    if (!this.firstPersonView) {
      return false
    }
    if (!this.persona) {
      return false
    }
    if (this.cameraZoomed) {
      this.toggleZoom()
    }
    this.cameraDistance = 0
    this.targetCameraDistance = startingDistance
    this.persona.firstPersonView = false
    this.firstPersonView = false
    return true
  }

  enterFirstPerson() {
    if (this.firstPersonView) {
      return false
    }
    if (this.cameraZoomed) {
      this.toggleZoom()
    }
    this.firstPersonView = true
    this.camera.orbit = false
    this.camera.autoRotate = false
    this.camera.rotation.x = 0
    return true
  }

  private snapIso() {
    const step = Math.PI / 2
    const off = Math.PI / 4
    const y = Math.round((this.camera.rotation.y - off) / step) * step + off
    this.camera.rotation.x = ISO_PITCH
    this.camera.rotation.y = y
    this.camera.cameraRotation.set(0, 0)
    if (this.persona) this.persona.rotation.y = y
  }

  startConga(target: Avatar) {
    if (target.isDisposed()) return
    this.canvas.focus() // joining via a chat link leaves focus on the <a>; canvas needs focus or WASD/Escape can't leave the line
    this.congaTarget = target
    this.congaSyncGraceUntil = Date.now() + 2500
    this.congaSawLeaderInConga = false
    this.congaTargetPrevPos = null
    this.congaGroupBlend = 0
    this.congaFlyingRestore = this.flying
    this.connector.bumpCongaFollowUi()
    if (this.firstPersonView) this.enterThirdPerson()
  }

  stopConga() {
    const restoreFly = this.congaFlyingRestore
    this.congaTarget = null
    this.congaSyncGraceUntil = 0
    this.congaSawLeaderInConga = false
    this.congaTargetPrevPos = null
    this.congaGroupBlend = 0
    this.congaFlyingRestore = null
    if (restoreFly !== null) {
      this.setFlying(restoreFly)
    }
    // Must clear; leaving via keys only called stopConga() and left inConga true (looked like "leading" with no target).
    this.connector.clearCongaLeaderStartedBanner()
    this.connector.inConga = false
    this.connector.beginCongaJoinHintSuppressionAfterLeave()
  }

  /** The avatar who started this line (head of the chain), for UI. Null when leading or not in a line. */
  get congaLeaderAvatar(): Avatar | null {
    return this.congaTarget ? this.resolveCongaLeaderAvatar(this.congaTarget) : null
  }

  /** Walk toward conga head using each avatar's congaFollowsUuid (who they follow). Old clients omit it; then `first` is used. */
  private resolveCongaLeaderAvatar(first: Avatar): Avatar {
    let L: Avatar = first
    const seen = new Set<string>()
    for (let i = 0; i < 24; i++) {
      const fid = L.congaFollowsUuid
      if (!fid) return L
      if (seen.has(L.uuid)) return first
      seen.add(L.uuid)
      const next = this.connector.findAvatar(fid) as Avatar | null
      if (!next?.inConga) return L
      L = next
    }
    return L
  }

  private updateConga() {
    const target = this.congaTarget
    if (!target || !target.hasPosition || target.isDisposed()) {
      if (this.congaTarget) this.stopConga()
      return
    }

    if (!target.inConga) {
      if (this.congaSawLeaderInConga) {
        this.stopConga()
        return
      }
      if (Date.now() >= this.congaSyncGraceUntil) {
        this.stopConga()
        return
      }
    } else {
      this.congaSawLeaderInConga = true
    }

    const leaderAv = this.resolveCongaLeaderAvatar(target)
    const leaderFlying = leaderAv.getTransform().animation === Animations.Floating
    if (leaderFlying !== this.flying) {
      this.setFlying(leaderFlying)
    }

    // match leader's facing direction
    this.camera.rotation.y = target.orientation.y

    const forward = new BABYLON.Vector3(Math.sin(target.orientation.y), 0, Math.cos(target.orientation.y))
    let right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), forward)
    if (right.lengthSquared() < 1e-10) {
      right = new BABYLON.Vector3(1, 0, 0)
    } else {
      right.normalize()
    }

    const bp = new BABYLON.Vector3(this.body.position.x, this.body.position.y, this.body.position.z)
    const dir = target.position.subtract(bp)
    dir.y = 0
    const gapHz = dir.length()
    const gap3 = BABYLON.Vector3.Distance(target.position, bp)
    if (leaderFlying ? gap3 > 30 : gapHz > 30) {
      const tp = target.position.subtract(forward.scale(CONGA_FOLLOW_DISTANCE))
      if (!leaderFlying) {
        tp.y = this.body.position.y
      }
      this.persona.teleportNoHistory({ position: tp })
      return
    }

    const deltaTime = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.1)

    const prev = this.congaTargetPrevPos
    if (prev) {
      const targetMoved = BABYLON.Vector3.Distance(target.position, prev) > 0.022
      if (targetMoved) {
        this.congaGroupBlend = Math.max(0, this.congaGroupBlend - deltaTime * 4)
      } else {
        this.congaGroupBlend = Math.min(1, this.congaGroupBlend + deltaTime * 1.75)
      }
    }
    this.congaTargetPrevPos = target.position.clone()

    const g = this.congaGroupBlend
    const backDist = CONGA_FOLLOW_DISTANCE + CONGA_STOPPED_EXTRA_BACK * g
    const lateral = congaLateralSlot(this.connector.persona.uuid) * CONGA_LATERAL_PER_SLOT * g
    const desired = target.position.subtract(forward.scale(backDist)).add(right.scale(lateral))
    if (!leaderFlying) {
      desired.y = this.body.position.y
    }

    let pull = desired.subtract(bp)
    if (!leaderFlying) {
      pull.y = 0
    }
    const pullLen = pull.length()
    if (pullLen < 0.015) return

    pull.normalize()
    const step = Math.min(1, deltaTime * (3 + pullLen * 1.8))
    pull.scaleInPlace(Math.min(pullLen, pullLen * step))
    this.body.position.x += pull.x
    this.body.position.y += pull.y
    this.body.position.z += pull.z
  }

  getCoords() {
    const coords = {
      position: this.persona.position.clone(),
      rotation: this.camera.rotation.clone(),
    }

    return encodeCoords(coords)
  }

  /**
   * BabylonJS predicate for deciding what can be picked by mouse-move events.
   * Default implementation allows only sliders.
   * This can be overridden, e.g. in tools/voxel.ts and tools/feature.ts
   */
  defaultPointerMovePredicate(mesh: BABYLON.AbstractMesh): boolean {
    // CV custom additional check
    return (
      !!mesh.metadata?.captureMoveEvents &&
      // Default checks that Bablyon performs
      mesh.isPickable &&
      mesh.isVisible &&
      mesh.isReady() &&
      mesh.isEnabled() &&
      (mesh.enablePointerMoveEvents || this.scene.constantlyUpdateMeshUnderPointer || mesh._getActionManagerForTrigger() != null) &&
      (!this.scene.cameraToUseForPointers || (this.scene.cameraToUseForPointers.layerMask & mesh.layerMask) !== 0)
    )
  }

  // --- ride ---

  findNearbyDriveable(): import('../features/vox-model').Ride | null {
    const grid = this.grid
    if (!grid) return null
    const me = this.persona.position
    let best: import('../features/vox-model').Ride | null = null
    let bestD = Infinity
    // distance to the mesh surface (not the pivot) - rides are often wider than 4m
    const reachSq = 2.5 * 2.5
    const parcels = this.grid.parcels
    if (!parcels) return null
    for (const parcel of parcels.values()) {
      for (const f of parcel.featuresList || []) {
        if (f?.type !== 'ride') continue
        const m = f as import('../features/vox-model').Ride
        if (!m.mesh) continue
        const bb = m.boundingBox
        let d: number
        if (bb) {
          const closest = BABYLON.Vector3.Clamp(me, bb.minimumWorld, bb.maximumWorld)
          d = BABYLON.Vector3.DistanceSquared(me, closest)
        } else {
          const p = m.absolutePosition
          if (!p) continue
          d = BABYLON.Vector3.DistanceSquared(me, p)
        }
        if (d < reachSq && d < bestD) {
          bestD = d
          best = m
        }
      }
    }
    return best
  }

  tryEnterVehicle() {
    if (this.vehicleFeature) {
      this.stopVehicle()
      return
    }
    const car = this.findNearbyDriveable()
    if (car) this.enterVehicle(car)
  }

  /** enter a specific ride (E key path and the floating Drive button both land here) */
  enterVehicle(car: import('../features/vox-model').Ride) {
    if (this.vehicleFeature) return
    if (this.congaTarget) this.stopConga()
    if (car.driverUuid && car.driverUuid !== this.persona.uuid) return
    if (!car.claimDriver(this.persona.uuid)) return
    this.vehicleFeature = car
    this.vehicleHoverY = car.mesh?.position.y ?? 0
    this.vehicleLastDryPos = car.mesh?.position.clone() ?? null
    this.vehicleLastDryRot = car.mesh?.rotation.clone() ?? null
    this.vehicleWasFirstPerson = this.firstPersonView
    this.vehicleFlyingRestore = this.flying
    this.vehicleSeatOffset = this.readDriveSeatOffset(car)
    this.vehicleSeatMode = false
    this.setNoclip(true)
    this.disableMovement()
    // features freeze their world matrix after setCommon - thaw so drive pose updates show up
    car.mesh?.unfreezeWorldMatrix()
    if (car.mesh?.rotationQuaternion) car.mesh.rotationQuaternion = null
    this.persona.audio?.footstepSounds?.noStep()
    this.persona.animation = Animations.Sitting
    this.vehicleFacingNudge = 0
    // start in chase cam so you can see the car; C still toggles first/third while driving
    if (this.firstPersonView) this.enterThirdPerson(5)
    this.camera.rotation.y = this.driveFacingYaw(car)
    this.setVehicleHint(this.driveHint(car))
    this.refreshMobileDriveChrome?.()
  }

  private driveHint(car: import('../features/vox-model').Ride): string {
    const fly = car.isFlyable ? ' · Space/V climb' : ''
    const seat = car.parcel.canEdit ? ' · G seat' : ''
    return `T turn facing · C camera · E exit${fly}${seat}`
  }

  /** G while seated (owners): drive keys move the seat; G again saves and goes back to driving */
  toggleSeatMode() {
    const car = this.vehicleFeature
    if (!car?.parcel.canEdit) return
    this.vehicleSeatMode = !this.vehicleSeatMode
    if (this.vehicleSeatMode) {
      this.setVehicleHint('adjust seat: WASD move · R/F up/down · G save')
    } else {
      this.flushDriveSeatOffset()
      this.setVehicleHint('seat saved')
    }
  }

  private readDriveSeatOffset(car: import('../features/vox-model').Ride): [number, number, number] {
    const o = (car.description as { driveSeatOffset?: number[] }).driveSeatOffset
    if (Array.isArray(o) && o.length >= 3) {
      return [Number(o[0]) || 0, Number(o[1]) || 0, Number(o[2]) || 0]
    }
    return [0, 1.2, 0]
  }

  private flushDriveSeatOffset() {
    const car = this.vehicleFeature
    if (!car?.parcel.canEdit) return
    const o = this.vehicleSeatOffset
    car.set({ driveSeatOffset: [o[0], o[1], o[2]] } as any)
  }

  /** While seated: nudge which way is "forward" (W + look). Saves on the ride if you can edit. */
  nudgeDriveFacing(delta = Math.PI / 2) {
    const car = this.vehicleFeature
    if (!car) return
    if (car.parcel.canEdit) {
      const cur = Number((car.description as { driveYawOffset?: number }).driveYawOffset) || 0
      const twoPi = Math.PI * 2
      const next = (((cur + delta) % twoPi) + twoPi) % twoPi
      car.set({ driveYawOffset: next } as any)
      this.vehicleFacingNudge = 0
    } else {
      this.vehicleFacingNudge += delta
    }
    this.camera.rotation.y += delta
    this.setVehicleHint('facing turned 90')
  }

  /** yaw the seated avatar / W should use; null if not driving */
  getVehicleDriveYaw(): number | null {
    if (!this.vehicleFeature) return null
    return this.driveFacingYaw(this.vehicleFeature)
  }

  private driveFacingYaw(car: import('../features/vox-model').Ride): number {
    // default +PI = vox local -Z; driveYawOffset / nudge for seated adjustments
    const saved = Number((car.description as { driveYawOffset?: number }).driveYawOffset) || 0
    return (car.mesh?.rotation.y ?? 0) + Math.PI + saved + this.vehicleFacingNudge
  }

  stopVehicle() {
    this.flushDriveSeatOffset()
    const car = this.vehicleFeature
    this.vehicleFeature = null
    this.vehicleSeatMode = false
    this.vehicleSteer.forward = 0
    this.vehicleSteer.turn = 0
    this.driveHeld.clear()
    this.vehicleFacingNudge = 0
    if (car) {
      try {
        // left far from the lot: snap home now. unloading the parcel would kill the recall timer and strand it.
        if (car.isAwayFromPark()) car.recallToPark()
        else car.releaseDriver(this.persona.uuid)
      } catch {}
      try {
        car.mesh?.freezeWorldMatrix()
      } catch {}
      try {
        this.grid?.unloadIfBeyondDraw?.(car.parcel)
      } catch {}
    }
    this.setNoclip(false)
    this.enableMovement()
    if (this.vehicleFlyingRestore !== null) {
      this.setFlying(this.vehicleFlyingRestore)
      this.vehicleFlyingRestore = null
    }
    if (this.vehicleWasFirstPerson) this.enterFirstPerson()
    this.refreshMobileDriveChrome?.()
  }

  /** optional hook for mobile Drive/Exit button labels */
  refreshMobileDriveChrome?(): void

  getVehicleAvatarPayload(): {
    featureUuid: string
    homeParcelId: number
    voxUrl: string
    scale: [number, number, number]
    yaw: number
    seat: [number, number, number]
  } | null {
    const car = this.vehicleFeature
    if (!car?.mesh) return null
    // live mesh.scaling matches what the driver sees (includes cubescale / nudge tweaks)
    const s = car.mesh.scaling
    const clamp = (n: number) => {
      const v = Math.abs(Number(n))
      if (!Number.isFinite(v) || v < 1e-4) return 1
      return Math.min(64, v)
    }
    return {
      featureUuid: car.uuid,
      homeParcelId: car.parcel.id,
      voxUrl: String(car.description.url || ''),
      scale: [clamp(s.x), clamp(s.y), clamp(s.z)],
      yaw: car.mesh.rotation.y,
      seat: [this.vehicleSeatOffset[0], this.vehicleSeatOffset[1], this.vehicleSeatOffset[2]],
    }
  }

  private setVehicleHint(text: string | null) {
    if (!text) {
      this.vehicleHintEl?.remove()
      this.vehicleHintEl = null
      return
    }
    if (!this.vehicleHintEl) {
      const el = document.createElement('div')
      el.className = 'vehicle-drive-hint'
      // same look as the mute hint so it reads over any scene
      el.style.cssText =
        'position:fixed;left:50%;bottom:5rem;transform:translateX(-50%);z-index:40;pointer-events:none;padding:4px 8px;background:rgba(13,13,13,0.85);color:#f5f5f0;font-family:"Source Code Pro",monospace;font-size:12px;white-space:nowrap;'
      document.body.appendChild(el)
      this.vehicleHintEl = el
    }
    this.vehicleHintEl.textContent = text
  }

  private readDriveInput(): { forward: number; turn: number } {
    let forward = this.vehicleSteer.forward
    let turn = this.vehicleSteer.turn
    const kb = (this as any).keyboardInput as { pressedCodes?: () => string[] } | undefined
    const codes = kb?.pressedCodes?.() || []
    const held = (code: string) => this.driveHeld.has(code) || codes.includes(code)
    if (held('KeyW') || held('ArrowUp')) forward = 1
    if (held('KeyS') || held('ArrowDown')) forward = -1
    if (held('KeyA') || held('ArrowLeft')) turn = -1
    if (held('KeyD') || held('ArrowRight')) turn = 1
    // mobile dpad: controls.direction is set by dpad (x = strafe, z = forward in camera space) - while driving use as steer
    if (this.direction && (Math.abs(this.direction.x) > 0.05 || Math.abs(this.direction.z) > 0.05)) {
      forward = this.direction.z
      turn = this.direction.x
    }
    return { forward, turn }
  }

  private updateVehicle() {
    // proximity hint when not driving
    if (!this.vehicleFeature) {
      const now = Date.now()
      if (now - this.vehicleNearbyAt > 250) {
        this.vehicleNearbyAt = now
        this.vehicleNearby = this.findNearbyDriveable()
        this.refreshMobileDriveChrome?.()
      }
      const near = this.vehicleNearby
      if (near && !near.driverUuid) {
        this.setVehicleHint(isMobile() ? null : 'E drive')
      } else {
        this.setVehicleHint(null)
      }
      return
    }

    const car = this.vehicleFeature
    // driver dropped / parcel unloaded
    if (!car.mesh || car.disposed) {
      this.stopVehicle()
      return
    }
    // stale lock: if we think we drive but state says otherwise
    if (car.driverUuid && car.driverUuid !== this.persona.uuid) {
      this.vehicleFeature = null
      this.setNoclip(false)
      this.enableMovement()
      this.refreshMobileDriveChrome?.()
      return
    }
    // claim may have been lost - reassert periodically via broadcast
    if (!car.driverUuid) car.claimDriver(this.persona.uuid)

    const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000)
    const { forward, turn } = this.readDriveInput()
    const speed = this.running ? 8 : 4
    const turnSpeed = 1.6
    const kb = (this as any).keyboardInput as { pressedCodes?: () => string[] } | undefined
    const codes = kb?.pressedCodes?.() || []
    const held = (code: string) => this.driveHeld.has(code) || codes.includes(code)

    if (this.vehicleSeatMode && car.parcel.canEdit) {
      // seat mode: car parks, drive keys slide the seat (local to car; -z is the nose)
      const step = 1.5 * dt
      if (Math.abs(forward) > 0.01) this.vehicleSeatOffset[2] -= forward * step
      if (Math.abs(turn) > 0.01) this.vehicleSeatOffset[0] += turn * step
      if (held('KeyR')) this.vehicleSeatOffset[1] += step
      if (held('KeyF')) this.vehicleSeatOffset[1] -= step
    } else {
      // they know how to drive now - drop the teaching text
      if (this.vehicleHintEl && (Math.abs(forward) > 0.01 || Math.abs(turn) > 0.01)) this.setVehicleHint(null)
      if (Math.abs(turn) > 0.01) {
        const delta = turn * turnSpeed * dt
        // spin about the model's center, not the mesh origin (vox pivot isn't centered)
        const center = car.mesh.getBoundingInfo().boundingBox.centerWorld
        const px = car.mesh.absolutePosition.x - center.x
        const pz = car.mesh.absolutePosition.z - center.z
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        car.mesh.position.x += px * cos + pz * sin - px
        car.mesh.position.z += pz * cos - px * sin - pz
        car.mesh.rotation.y += delta
      }
      if (Math.abs(forward) > 0.01) {
        const facing = this.driveFacingYaw(car)
        car.mesh.position.x += Math.sin(facing) * forward * speed * dt
        car.mesh.position.z += Math.cos(facing) * forward * speed * dt
      }
      // hovercraft: Space/PageUp climb, V/PageDown dive
      if (car.isFlyable) {
        let climb = 0
        if (held('Space') || held('PageUp')) climb = 1
        if (held('KeyV') || held('PageDown')) climb = -1
        if (climb) this.vehicleHoverY += climb * speed * dt
        // soft floor - water rescue still snaps if you go under
        if (this.vehicleHoverY < SWIM_LEVEL + 0.5) this.vehicleHoverY = SWIM_LEVEL + 0.5
      }
    }
    car.mesh.position.y = this.vehicleHoverY
    // frozen meshes need freezeWorldMatrix() again to bake the new pose (computeWorldMatrix alone is a no-op when frozen)
    if (car.mesh.isWorldMatrixFrozen) car.mesh.freezeWorldMatrix()
    else car.mesh.computeWorldMatrix(true)

    // water rescue: swim level
    const worldY = car.absolutePosition?.y ?? car.mesh.position.y
    if (worldY < SWIM_LEVEL) {
      if (this.vehicleLastDryPos && this.vehicleLastDryRot) {
        car.mesh.position.copyFrom(this.vehicleLastDryPos)
        car.mesh.rotation.copyFrom(this.vehicleLastDryRot)
        this.vehicleHoverY = this.vehicleLastDryPos.y
        if (car.mesh.isWorldMatrixFrozen) car.mesh.freezeWorldMatrix()
        else car.mesh.computeWorldMatrix(true)
        car.broadcastDriveState()
      } else {
        car.recallToPark()
        this.stopVehicle()
        return
      }
    } else {
      this.vehicleLastDryPos = car.mesh.position.clone()
      this.vehicleLastDryRot = car.mesh.rotation.clone()
    }

    // seat: put camera on driveSeatOffset (local to mesh) so sendAvatar rides with the car
    if (car.mesh) {
      const [ox, oy, oz] = this.vehicleSeatOffset
      this.vehicleSeatLocal.copyFromFloats(ox, oy, oz)
      BABYLON.Vector3.TransformCoordinatesToRef(this.vehicleSeatLocal, car.mesh.getWorldMatrix(), this.vehicleSeatWorld)
      Object.assign(this.body.position, { x: this.vehicleSeatWorld.x, y: this.vehicleSeatWorld.y, z: this.vehicleSeatWorld.z })
      // mouse owns look (pitch + yaw); car facing is separate via getVehicleDriveYaw
    }

    const now = Date.now()
    if (now - this.vehicleLastStateAt > 120) {
      this.vehicleLastStateAt = now
      car.broadcastDriveState()
    }
  }
}

function generateReticule(scene: BABYLON.Scene) {
  const w = 128
  const utilLayer = new BABYLON.UtilityLayerRenderer(scene)
  const utilScene = utilLayer.utilityLayerScene
  const texture = new BABYLON.DynamicTexture('reticule', w, scene, false)
  texture.hasAlpha = true

  const ctx = <CanvasRenderingContext2D>texture.getContext()
  const radius = w * 0.2
  const centerX = w * 0.5
  const centerY = w * 0.5

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.lineWidth = 4
  for (let i = 0; i <= 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const x = centerX + radius * Math.cos(angle)
    const y = centerY + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(x + 2, y + 2)
    else ctx.lineTo(x + 2, y + 2)
  }
  ctx.stroke()

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 4
  for (let i = 0; i <= 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const x = centerX + radius * Math.cos(angle)
    const y = centerY + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  texture.update()

  const root = new BABYLON.TransformNode('reticule', utilScene)
  root.position.set(0, 0, 0.2)

  const colors: [string, BABYLON.Color3][] = [
    ['r', new BABYLON.Color3(1, 0.15, 0.15)],
    ['g', new BABYLON.Color3(0.15, 1, 0.15)],
    ['b', new BABYLON.Color3(0.15, 0.4, 1)],
  ]

  const channels = colors.map(([suffix, color]) => {
    const material = new BABYLON.StandardMaterial(`reticule_${suffix}`, utilScene)
    material.diffuseTexture = texture
    material.opacityTexture = texture
    material.emissiveColor.copyFrom(color)
    material.disableLighting = true
    material.alphaMode = BABYLON.Engine.ALPHA_ADD
    material.disableDepthWrite = true

    const mesh = BABYLON.MeshBuilder.CreatePlane(`reticule_${suffix}`, { size: 0.04 }, utilScene)
    mesh.material = material
    mesh.parent = root
    mesh.isPickable = false
    mesh.visibility = 0
    return mesh
  })

  return { root, channels }
}

export function featureFromPick(pickInfo?: BABYLON.PickingInfo | null): Feature | null {
  const mesh = pickInfo?.pickedMesh as MeshExtended | null
  if (!mesh) return null
  if (mesh.feature) return mesh.feature
  const parent = mesh.parent as MeshExtended | null
  if (parent?.feature) return parent.feature
  return null
}
