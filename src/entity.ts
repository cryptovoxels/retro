import { Animations, AvatarAnimations } from './avatar-animations'
import { cameraPosition } from './utils/camera'
import { Transform, TransformQueue } from './utils/transform'
import { AVATAR_VIEW_DISTANCE, INTERPOLATION_MAX_VELOCITY } from './constants'
import { encodeCoords } from '../common/helpers/utils'
import { Quat, SceneContext, TransformNode, Vec3, onBeforeRender } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

type timestamp = number

export abstract class Entity {
  public readonly joinedAt: timestamp = 0
  protected readonly scene: SceneContext
  protected readonly node: TransformNode
  protected tickRate: number = 1000 / 5
  protected lastTeleportAt: timestamp = 0
  protected lastMovedAt: timestamp = 0
  protected _orientationQuaternion = quat.create()
  protected transformQueue: TransformQueue | null = null
  protected animation: AvatarAnimations | null = null
  protected startAnimation: Animations = Animations.Idle
  protected state: 'disposed' | 'loading' | 'loaded' = 'disposed'
  protected onBeforeRenderObservable: (any | null) | null = null

  animationOverride: Animations | null = null

  protected constructor(scene: SceneContext, parent: (TransformNode | null), joined: timestamp) {
    this.scene = scene
    this.node = (undefined as any /* todo(lite): new BABYLON.TransformNode('entity', this.scene) */)
    this.node.setParent(parent)
    this.node.setEnabled(false)
    this.joinedAt = joined
  }

  protected _position = vec3.create()

  /**
   * Getter to obtain the position of the avatar.
   * @returns {BABYLON.Vector3} position
   */
  get position() {
    return this._position
  }

  protected _orientation = vec3.create()

  get orientation(): Vec3 {
    return this._orientation
  }

  protected _distanceFromCamera = Infinity

  get distanceFromCamera() {
    return this._distanceFromCamera
  }

  get absolutePosition(): Vec3 {
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
      rotation: vec3.fromValues(0, Math.PI, 0),
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

  getDistanceFrom(position: Vec3): number {
    if (!this.position || this.lastMovedAt === 0) return Infinity
    // this might fail for some reason, probably bad state from multiplayer
    // if it fails, just treat as infinite distance so we don't break womp broadcast updating
    // on error resume next....🤦
    try {
      return vec3.distance(position, this.position)
    } catch (ex) {
      return Infinity
    }
  }

  public move(transform: { position: Vec3; orientation: Quat; animation: Animations; timestamp: number }) {
    if (!this.isLoaded()) {
      this.setTransform(transform)
      return
    }
    this.transformQueue?.add(transform)
  }

  protected setTransform(i: Transform) {
    this._position.copyFrom(i.position)
    this.node.position.copyFrom(this._position)
    this._distanceFromCamera = this.scene.activeCamera ? vec3.distance(this._position, cameraPosition(this.scene)) : Infinity

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
    this.onBeforeRenderObservable = onBeforeRender(this.scene, this.update.bind(this))
    this.state = 'loaded'
    // will trigger hooks, orient the mesh and trigger some sort of dirty on the mesh(es)
    this.move({
      position: this._position,
      orientation: this._orientationQuaternion,
      animation: this.animation?.state || this.startAnimation,
      timestamp: Date.now(),
    })
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
    this.onAfterUpdate(previous)
  }

  protected abstract onAfterUpdate(previous: Readonly<Transform>): void
}
