import { Animations, AvatarAnimations } from './avatar-animations'
import { cameraPosition } from './utils/camera'
import { Transform, TransformQueue } from './utils/transform'
import { AVATAR_VIEW_DISTANCE, INTERPOLATION_MAX_VELOCITY } from './constants'
import { encodeCoords } from '../common/helpers/utils'
import { physics, RAPIER } from './physics/world'

type timestamp = number

export abstract class Entity {
  public readonly joinedAt: timestamp = 0
  protected readonly scene: BABYLON.Scene
  protected readonly node: BABYLON.TransformNode
  protected tickRate: number = 1000 / 5
  protected lastTeleportAt: timestamp = 0
  protected lastMovedAt: timestamp = 0
  protected _orientationQuaternion = BABYLON.Quaternion.Zero()
  protected transformQueue: TransformQueue | null = null
  protected animation: AvatarAnimations | null = null
  protected startAnimation: Animations = Animations.Idle
  protected state: 'disposed' | 'loading' | 'loaded' = 'disposed'
  protected onBeforeRenderObservable: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> | null = null
  private physicsBody: any = null
  private physicsCollider: any = null

  animationOverride: Animations | null = null

  protected constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode, joined: timestamp) {
    this.scene = scene
    this.node = new BABYLON.TransformNode('entity', this.scene)
    this.node.setParent(parent)
    this.node.setEnabled(false)
    this.joinedAt = joined
  }

  protected _position = BABYLON.Vector3.Zero()

  /**
   * Getter to obtain the position of the avatar.
   * @returns {BABYLON.Vector3} position
   */
  get position() {
    return this._position
  }

  protected _orientation = BABYLON.Vector3.Zero()

  get orientation(): BABYLON.Vector3 {
    return this._orientation
  }

  protected _distanceFromCamera = Infinity

  get distanceFromCamera() {
    return this._distanceFromCamera
  }

  get absolutePosition(): BABYLON.Vector3 {
    return this.node.absolutePosition
  }

  /**
   * Getter to obtain the coordinates of the avatar
   * @returns {string} Encoded position.
   */
  get coords(): string {
    if (!this.hasPosition) {
      return ''
    }
    const v = this.position.clone()
    v.z += 1.5

    return encodeCoords({
      position: v,
      rotation: new BABYLON.Vector3(0, Math.PI, 0),
    })
  }

  // check if the avatar has a position in the world
  get hasPosition() {
    // all avatars with a position in the world should have a non zero last moved at timestamp
    return this.lastMovedAt !== 0
  }

  public getTransform(): Readonly<Transform> {
    return {
      animation: this.animation?.state || this.startAnimation,
      orientation: this._orientationQuaternion.clone(),
      position: this.position.clone(),
      timestamp: Date.now(),
    }
  }

  /**
   /**
   * Returns whether an avatar is nearby within AVATAR_VIEW_DISTANCE meters from the active camera
   */
  nearby(padding = 0): boolean {
    if (!this.scene.activeCamera) return false

    const radiusThreshold = AVATAR_VIEW_DISTANCE + padding

    const p = this.position
    // prevent avatars that spawned at the buggy 0,0,0 position (under the origin) to ever be loaded
    if (p.x === 0 && p.y === 0 && p.z === 0) {
      return false
    }

    const sqrCamDist = cameraPosition(this.scene).clone().subtract(p).lengthSquared()
    return sqrCamDist < radiusThreshold * radiusThreshold
  }

  isLoaded() {
    return this.state === 'loaded'
  }

  isLoading() {
    return this.state === 'loading'
  }

  isDisposed() {
    return this.state === 'disposed'
  }

  getDistanceFrom(position: BABYLON.Vector3): number {
    if (!this.position || this.lastMovedAt === 0) return Infinity
    // this might fail for some reason, probably bad state from multiplayer
    // if it fails, just treat as infinite distance so we don't break womp broadcast updating
    // on error resume next....🤦
    try {
      return BABYLON.Vector3.Distance(position, this.position)
    } catch (ex) {
      return Infinity
    }
  }

  public move(transform: { position: BABYLON.Vector3; orientation: BABYLON.Quaternion; animation: Animations; timestamp: number }) {
    if (!this.isLoaded()) {
      this.setTransform(transform)
      return
    }
    this.transformQueue?.add(transform)
  }

  protected setTransform(i: Transform) {
    this._position.copyFrom(i.position)
    this.node.position.copyFrom(this._position)
    this._distanceFromCamera = this.scene.activeCamera ? BABYLON.Vector3.Distance(this._position, cameraPosition(this.scene)) : Infinity

    this._orientationQuaternion.copyFrom(i.orientation)
    this._orientation.copyFrom(this._orientationQuaternion.toEulerAngles())
    this.node.rotation = this._orientation

    if (this.animation) {
      this.animation.set(this.animationOverride || i.animation)
    } else {
      this.startAnimation = i.animation
    }

    this.lastMovedAt = Date.now()
    ;(this as any).syncVehicleMeshPose?.()
  }

  protected load() {
    this.state = 'loading'

    this.node.rotation.set(0, 0, 0)
    this.node.setEnabled(true)

    this.transformQueue = new TransformQueue(this.tickRate, INTERPOLATION_MAX_VELOCITY)
    this.animation = new AvatarAnimations()
  }

  protected loadFinished() {
    this.onBeforeRenderObservable = this.scene.onBeforeRenderObservable.add(this.update.bind(this))
    this.state = 'loaded'
    this.ensurePhysicsCapsule()
    // will trigger hooks, orient the mesh and trigger some sort of dirty on the mesh(es)
    this.move({
      position: this._position,
      orientation: this._orientationQuaternion,
      animation: this.animation?.state || this.startAnimation,
      timestamp: Date.now(),
    })
  }

  private ensurePhysicsCapsule() {
    const w = physics()
    if (!w || this.physicsBody) return
    this.physicsBody = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this._position.x, this._position.y + 0.85, this._position.z))
    this.physicsCollider = w.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.25), this.physicsBody)
  }

  private syncPhysicsCapsule() {
    if (!this.physicsBody) return
    this.physicsBody.setNextKinematicTranslation({ x: this._position.x, y: this._position.y + 0.85, z: this._position.z })
  }

  protected dispose() {
    this.node.setEnabled(false)

    if (this.onBeforeRenderObservable) {
      this.scene.onBeforeRenderObservable.remove(this.onBeforeRenderObservable)
      this.onBeforeRenderObservable = null
    }
    if (this.transformQueue) {
      this.transformQueue.clear(0)
      this.transformQueue = null
    }
    const w = physics()
    if (w && this.physicsBody) {
      if (this.physicsCollider) w.removeCollider(this.physicsCollider, true)
      w.removeRigidBody(this.physicsBody)
      this.physicsBody = null
      this.physicsCollider = null
    }
    this.animation?.dispose()
    this.animation = null
    this.state = 'disposed'
  }

  protected abstract onBeforeUpdate(next: Readonly<Transform>): void

  protected update() {
    const t = this.transformQueue?.get(Date.now() - this.tickRate)
    if (!t) {
      // no position, rotation or animation has changed, so dont update stuff
      return
    }
    this.onBeforeUpdate(t)

    const previous = this.getTransform()
    this.setTransform(t)
    this.node.computeWorldMatrix(true)
    this.syncPhysicsCapsule()
    this.onAfterUpdate(previous)
  }

  protected abstract onAfterUpdate(previous: Readonly<Transform>): void
}
