import { isDesktop, isMobile } from '../../common/helpers/detector'
import { User } from '../user'
import { decodeCoordsFromURL } from '../utils/helpers'
import { encodeCoords } from '../../common/helpers/utils'
import type Grid from '../grid'
import Connector from '../connector'
import OurCamera from './utils/our-camera'
import { isLoaded } from '../utils/loading-done'
import Feature, { MeshExtended } from '../features/feature'
import Avatar from '../avatar'
import type { Scene } from '../scene'
import type { Environment } from '../enviroments/environment'
import { hasPointerLock } from '../../common/helpers/ui-helpers'
import { IControls } from './iControls'

export const CAMERA_DISTANCE = isMobile() ? 2.5 : 1.5
export const MIN_CAMERA_DISTANCE = 0.5
export const MAX_CAMERA_DISTANCE = 10
const CAMERA_EASE_OUT = 1.4
const SWIM_LEVEL = -2

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
  camera: OurCamera | BABYLON.ArcRotateCamera = undefined!
  // initialCameraPos:
  // this allows us to do camera transformation for 1st/3rd view and still keeping the
  // Controls to move the camera. The trick is to cache the camera position before rendering
  // the 3rd person view so that we can reset the camera position after the rendering for control
  // purposes. If we manage to change the controls to move the Persona, we wont need to do this
  // hack.
  initialCameraPos: BABYLON.Vector3 | null = null
  facingForward = true
  hasGamepad = false
  flying = true
  jumping = false
  swimming = false
  cameraDistance = 0
  targetCameraDistance: number = CAMERA_DISTANCE
  reticuleNormal: BABYLON.Mesh
  reticuleHighlight: BABYLON.Mesh
  user: User
  defaultSpeed = 0.88
  runSpeed = 4.0
  running = false
  movementEnabled = true
  shiftKey = false
  ctrlKey = false
  firstPersonView = true
  walkRunAnimation: BABYLON.Animatable | null = null

  // Transformation of world coordinates to a smaller absolute coordinates near the player, to avoid floating-point precision issues when visiting far-off island
  // Only setting position is supported, not rotation or scale.
  worldOffset: BABYLON.TransformNode

  grounded = true

  followTarget: Avatar | null = null
  private followBreadcrumbs: BABYLON.Vector3[] = []
  private followBreadcrumbIndex = 0

  MAX_PICK_DISTANCE = 20
  gravityDisabledOverride: boolean | null = null
  audioContext: AudioContext = undefined!
  private cameraZoomed = false
  // For gravity gating. See refreshGravity().
  private _containingParcelsWaitState: 'ready' | 'waiting-for-parcel-list' | 'waiting-for-colliders' = 'ready'
  private _containingParcels: number[] = []

  constructor(
    protected scene: Scene,
    protected canvas: HTMLCanvasElement,
  ) {
    this.user = window.user

    this.worldOffset = new BABYLON.TransformNode('avatar/worldOffset', this.scene)

    // ensure world offset is set, otherwise risk of race condition
    const coords = decodeCoordsFromURL()
    this.worldOffset.position.set(-coords.position.x, 0, -coords.position.z)

    // Add input system specific controls and cameras
    const camera = this.createCamera()
    this.addControls(camera)

    this.camera = camera
    this.scene.activeCamera = camera
    camera.parent = this.worldOffset

    // Enable feature clicking
    this.scene.onPointerObservable.add(this.featureClickHandler.bind(this))

    this.reticuleNormal = generateReticule(scene, false)
    this.reticuleNormal.setEnabled(true)
    this.reticuleNormal.parent = this.camera
    this.reticuleHighlight = generateReticule(scene, true)
    this.reticuleHighlight.setEnabled(false)
    this.reticuleHighlight.parent = this.camera

    if (isDesktop() && this.scene.config.wantsUI) {
      this.scene.registerBeforeRender(() => {
        // Show the reticule in 20% visibility in 3rd person mode.
        this.reticuleNormal.visibility = hasPointerLock() || this.hasGamepad ? (this.firstPersonView ? 1 : 0.2) : 0
        this.reticuleHighlight.visibility = hasPointerLock() || this.hasGamepad ? (this.firstPersonView ? 1 : 0.2) : 0
      })
    }

    if (!this.scene.config.isOrbit) {
      this.scene.onBeforeRenderObservable.add(() => {
        if (this.initialCameraPos) {
          console.warn('this.initialCameraPos already set in onBeforeRenderObservable(). suspected logic error')
        }

        this.updateFollow()

        // let persona update its position from the camera, since we are steering the camera
        this.persona.update(this.scene.cameraPosition, this.scene.cameraRotation, this)
        this.swimming = this.persona.isSwimming(SWIM_LEVEL) ?? this.swimming
        // store the position before we do camera adjustment in perspectiveAdjustment
        this.initialCameraPos = this.camera.position.clone()
        // adjust camera for 1st / 3rd person view
        this.firstOrThirdPersonAdjustment()
      })

      this.scene.onAfterRenderObservable.add(() => {
        if (this.initialCameraPos) {
          // we have rendered, possibly with the camera in 3rd person view, set it back to how it was before adjustement
          this.camera.position = this.initialCameraPos
          this.initialCameraPos = null
        } else {
          console.warn('resetCamera() called without an this.initialCameraPos. suspected logic error')
        }
      })
    }

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

  // Some work can't be done in the ctor, because the scene has not yet had its environment field set.
  attachEnvironment(environment: Environment) {
    environment.groundStateObservable.addStateObserver('loaded', () => this._handleGroundLoaded())
    environment.groundStateObservable.addStateObserver('unloaded', () => this._handleGroundUnloaded())
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
      animateFov(this.scene.fov.value)
    }
  }

  featureClickHandler(eventData: BABYLON.PointerInfo) {
    // Left-click pointerdown in lock mode
    // Note that we use POINTERTAP so it's the same event that captures pointerlock
    // This means that the pointerlock capture can "skipNextObservers" and supress this behavour
    if (eventData.event.button === 0 && eventData.type === BABYLON.PointerEventTypes.POINTERPICK && this.isFeatureClickingAllowed()) {
      // Don't allow feature clicking while the UI is visible
      if (window.ui?.visible || window.ui?.activeTool) {
        return
      }
      const distance = eventData.pickInfo?.distance || Infinity
      const parcel = (eventData?.pickInfo?.pickedMesh as MeshExtended | undefined)?.feature?.parcel
      // Dont allow clicking if user is far away; UNLESS the feature is from a parcel you can edit
      if (distance > this.MAX_PICK_DISTANCE && !parcel?.canEdit) return
      const candidateHandler = (eventData?.pickInfo?.pickedMesh as MeshExtended).cvOnLeftClick

      if (candidateHandler !== undefined) {
        candidateHandler(eventData?.pickInfo)
      }
    }
  }

  handleContextClick(pickInfo?: BABYLON.PickingInfo | null) {
    if (!pickInfo) return

    if (pickInfo.pickedMesh && 'feature' in pickInfo.pickedMesh && pickInfo.pickedMesh['feature'] instanceof Feature) {
      const feature = pickInfo.pickedMesh['feature']
      if (feature.onContextClick()) return
      // we fall back to viewing parcel info if the onContextClick isn't handled by feature
    }

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

  isOnGround(tolerance = 0): boolean {
    // If you're using an ArcRotateCamera you're never marked as being on the ground
    if (!('ellipsoid' in this.camera)) {
      return false
    }

    const distance = this.camera.ellipsoid.y * 2 + BABYLON.Epsilon + tolerance
    const globalPosition = this.persona.position.add(this.worldOffset.position)
    const ray = new BABYLON.Ray(globalPosition, new BABYLON.Vector3(0, -1), distance)
    const hit = this.scene.pickWithRay(ray, (e) => e.checkCollisions, true)
    return hit?.hit ?? false
  }

  firstOrThirdPersonAdjustment() {
    // build a vector projected backwards from the avatar away from the look-direction
    const cameraQuat = BABYLON.Quaternion.RotationYawPitchRoll(this.camera.rotation.y, this.camera.rotation.x, this.camera.rotation.z)
    const backwards = new BABYLON.Vector3(0, 0, -1).rotateByQuaternionToRef(cameraQuat, new BABYLON.Vector3())

    if (this.firstPersonView) {
      this.cameraDistance = easeCamera(this.cameraDistance, 0)
      if (this.cameraDistance <= 0) {
        this.persona.firstPersonView = this.firstPersonView
      }
    } else {
      // cast a ray back in the backwards direction, as a candidate 3rd-person camera positions
      // const avatarToCameraRay = new BABYLON.Ray(this.persona.position.add(this.worldOffset.position), backwards, this.targetCameraDistance)
      // // Allow visible, non-animated, non-avatar meshes in the to push the camera forward. Excluding animations stops the camera from changing without user action
      // const pickInfo = this.scene.pickWithRay(avatarToCameraRay, (e) => e.visibility > 0 && !e.metadata?.isAvatarPart && e.name !== 'avatar' && !e.animations?.length)
      // // ensure that a wall is not in between camera and avatar, brining the camera closer if needed
      // const clippedTargetDistance = pickInfo?.hit ? pickInfo.distance - 0.1 : this.targetCameraDistance
      // move closer to the target distance
      this.cameraDistance = 2.0 // this.targetCameraDistance // easeCamera(this.cameraDistance, clippedTargetDistance, 1.8)
    }

    // place camera
    this.camera.position.copyFrom(this.persona.position.add(backwards.scale(this.cameraDistance)))

    // Show/hide the avatar
    this.showSelfAvatar ? this.persona.avatar?.show() : this.persona.avatar?.hide()
  }

  abstract createCamera(): OurCamera | BABYLON.ArcRotateCamera

  abstract addControls(camera: OurCamera | BABYLON.ArcRotateCamera): void

  enableMovement() {
    this.camera.speed = this.running ? this.runSpeed : this.defaultSpeed
    this.movementEnabled = true
  }

  disableMovement() {
    this.camera.speed = 0
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
      this.walkRunAnimation = BABYLON.Animation.CreateAndStartAnimation('walk-to-run', this.camera, 'speed', fps, duration, this.camera.speed, this.runSpeed, undefined, WALK_TO_RUN_EASE)
      this.walkRunAnimation!.loopAnimation = false
    }
  }

  walk() {
    this.running = false

    if (this.movementEnabled) {
      const fps = 60
      const duration = 13
      this.walkRunAnimation?.stop()
      this.walkRunAnimation = BABYLON.Animation.CreateAndStartAnimation('walk-to-run', this.camera, 'speed', fps, duration, this.camera.speed, this.defaultSpeed, undefined, WALK_TO_RUN_EASE)
      this.walkRunAnimation!.loopAnimation = false
    }
  }

  resetWorldOffset(position: BABYLON.Vector3) {
    this.worldOffset.position.set(-position.x, 0, -position.z)

    const refreshRecursive = (mesh: BABYLON.TransformNode) => {
      mesh.markAsDirty('position')
      if (mesh.isWorldMatrixFrozen) {
        mesh.freezeWorldMatrix()
      } else {
        mesh.computeWorldMatrix()
      }

      // Thaw and refreeze any frozen world-matrices, as the global offset effects them
      mesh.getChildren().forEach((child) => {
        if (child instanceof BABYLON.TransformNode) {
          refreshRecursive(child)
        }
      })
    }

    refreshRecursive(this.worldOffset)
  }

  worldToAbsolutePosition(worldPosition: BABYLON.Vector3) {
    return this.worldOffset.absolutePosition.add(worldPosition)
  }

  setActiveReticule(highlight = false) {
    if (highlight && this.reticuleNormal.isEnabled()) {
      this.reticuleHighlight.setEnabled(true)
      this.reticuleNormal.setEnabled(false)
    } else if (!highlight && this.reticuleHighlight.isEnabled()) {
      this.reticuleHighlight.setEnabled(false)
      this.reticuleNormal.setEnabled(true)
    }
  }

  setFlying(value: boolean) {
    this.flying = value
  }

  toggleFlying() {
    if (!this.grounded) {
      // allow user to escape ungrounded state by pressing "F"
      // without this, if a user spawns in the air, they will be stuck flying until they get near the ground
      this.flying = false
      this.grounded = true
    } else {
      this.setFlying(!this.flying)
    }
  }

  // called on spawn and teleport
  public invalidateGroundLoaded() {
    if (!this.scene.environment) {
      throw new Error('invalidateGroundLoaded() called before attachEnvironment()!')
    }

    //TODO: Instead of switching on environment type here, this logic should probably be moved into methods in SpaceEnvironment and WorldEnvironment that override an abstract Environment method
    if (this.scene.config.isSpace) {
      // Spaces always contain exactly one Parcel with ID 0
      this._containingParcels = [0]
      this._containingParcelsWaitState = 'waiting-for-colliders'
    } else {
      if (!this.grid) {
        throw new Error('invalidateGroundLoaded() called before attachEnvironment()!')
      }

      // The main thread doesn't keep a complete list of parcels, so we need to wait for the grid worker to tell us the definitive set of parcels containing the camera.
      this._containingParcelsWaitState = 'waiting-for-parcel-list'
      this.grid.queryParcelsAtPosition(this.camera.position).then((parcelIds) => {
        this._containingParcels = parcelIds
        this._containingParcelsWaitState = 'waiting-for-colliders'
      })
    }

    this.scene.environment.invalidateGroundLoaded()
  }

  // this is called by the render loop in index.ts
  refreshGravity() {
    if (this.camera instanceof OurCamera) {
      // To avoid falling into the abyss, or through the floor of a second-floor parcel, gravity stays off at least until:
      // 1. All islands have been meshed (this.grounded === true), and
      // 2. Every parcel containing the camera position has a collider (this._containingParcelsWaitState === 'ready').
      if (this._containingParcelsWaitState === 'waiting-for-colliders' && this._containingParcels.every((id) => this.grid?.getByID(id)?.isColliderEnabled())) {
        this._containingParcels = []
        this._containingParcelsWaitState = 'ready'
      }
      this.camera.applyGravity = !this.flying && !this.swimming && this.grounded && isLoaded() && !this.gravityDisabledOverride && this._containingParcelsWaitState === 'ready'
    }
  }

  // Disables gravity until ground is detected underneath the avatar

  disableGravity() {
    console.debug('disabling gravity')
    this.gravityDisabledOverride = true
  }

  enableGravity() {
    console.debug('enabling gravity')
    this.gravityDisabledOverride = null
  }

  togglePerspective() {
    if (this.firstPersonView) {
      this.enterThirdPerson()
    } else {
      this.enterFirstPerson()
    }

    this.persona.setIdleFirstPerson(this.firstPersonView)
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
    return true
  }

  startFollowing(target: Avatar) {
    if (!target.allowFollow || target.isDisposed()) return
    this.followTarget = target
    this.followBreadcrumbs = []
    this.followBreadcrumbIndex = 0
    if (this.firstPersonView) this.enterThirdPerson()
  }

  stopFollowing() {
    this.followTarget = null
    this.followBreadcrumbs = []
    this.followBreadcrumbIndex = 0
  }

  private updateFollow() {
    const target = this.followTarget
    if (!target || !target.hasPosition || target.isDisposed()) {
      if (this.followTarget) this.stopFollowing()
      return
    }

    if (!target.allowFollow) {
      this.stopFollowing()
      return
    }

    this.followBreadcrumbs.push(target.position.clone())
    if (this.followBreadcrumbs.length > 600) {
      this.followBreadcrumbs.shift()
      this.followBreadcrumbIndex = Math.max(0, this.followBreadcrumbIndex - 1)
    }

    const gap = BABYLON.Vector3.Distance(this.camera.position, target.position)

    // leader teleported -- follow them
    if (gap > 30) {
      this.persona.teleportNoHistory({ position: target.position.clone() })
      this.followBreadcrumbs = []
      this.followBreadcrumbIndex = 0
      return
    }

    // close enough, idle
    if (gap < 3) return

    const crumb = this.followBreadcrumbs[this.followBreadcrumbIndex]
    if (!crumb) return

    const dir = crumb.subtract(this.camera.position)
    dir.y = 0
    const dist = dir.length()
    if (dist < 0.3) {
      this.followBreadcrumbIndex++
      return
    }

    dir.normalize()
    const speed = gap > 10 ? this.runSpeed : this.defaultSpeed
    const deltaTime = this.scene.getEngine().getDeltaTime() / 1000
    const step = speed * deltaTime
    this.camera.position.addInPlace(dir.scale(Math.min(step, dist)))
    this.camera.rotation.y = Math.atan2(dir.x, dir.z)
  }

  getCoords() {
    if (this.scene.config.isSpace) {
      // if we're in a space, we use create coordinates based on the camera position since Spaces are centered at 0,0,0
      return encodeCoords({ position: this.camera.position, rotation: this.camera.rotation })
    }

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

  /**
   * Are features able to be clicked on? Overridden in device-specific control classes
   */
  isFeatureClickingAllowed(): boolean {
    return true
  }

  protected _handleGroundUnloaded() {
    this.grounded = false
  }

  protected _handleGroundLoaded() {
    this.grounded = true
  }
}

function generateReticule(scene: BABYLON.Scene, highlight = false) {
  let name = 'reticule'
  if (highlight) {
    name += '_highlight'
  }
  const w = 128
  const utilLayer = new BABYLON.UtilityLayerRenderer(scene)
  const texture = new BABYLON.DynamicTexture(name, w, scene, false)
  texture.hasAlpha = true

  const ctx = <CanvasRenderingContext2D>texture.getContext()

  const createHexagon = () => {
    const radius = w * 0.1
    const centerX = w * 0.5
    const centerY = w * 0.5

    // Background
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = 2

    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      const x = centerX + radius * Math.cos(angle)
      const y = centerY + radius * Math.sin(angle)
      if (i === 0) {
        ctx.moveTo(x + 2, y + 2)
      } else {
        ctx.lineTo(x + 2, y + 2)
      }
    }

    ctx.stroke()

    // Foreground
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = highlight ? 3 : 2

    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      const x = centerX + radius * Math.cos(angle)
      const y = centerY + radius * Math.sin(angle)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }

    ctx.stroke()

    texture.update()
  }

  createHexagon()

  const material = new BABYLON.StandardMaterial(name, scene)
  material.diffuseTexture = texture
  material.opacityTexture = texture
  material.emissiveColor.set(1, 1, 1)
  material.disableLighting = true

  const reticule = BABYLON.MeshBuilder.CreatePlane(name, { size: 0.02 }, utilLayer.utilityLayerScene)
  reticule.material = material
  reticule.position.set(0, 0, 0.2)
  reticule.isPickable = false
  // reticule.rotation.z = Math.PI / 4
  // set invisible until render loop starts
  reticule.visibility = 0

  // material.freeze()
  // material.blockDirtyMechanism = true

  // if (highlight) {
  //   animateReticuleScale(reticule)
  // }

  return reticule
}

// function animateReticuleScale(mesh: BABYLON.Mesh) {
//   const frameRate = 60
//   const animation = new BABYLON.Animation('Scal', 'scaling', frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE)

//   // An array with all animation keys
//   const keyframes = [
//     {
//       frame: 0,
//       value: new BABYLON.Vector3(1, 1, 1),
//     },
//     {
//       frame: 30,
//       value: new BABYLON.Vector3(1.3, 1.3, 1.3),
//     },
//     {
//       frame: 60,
//       value: new BABYLON.Vector3(1, 1, 1),
//     },
//   ]

//   animation.setKeys(keyframes)

//   mesh.getScene().beginDirectAnimation(mesh, [animation], 0, 2 * frameRate, true)
//   return mesh
// }
