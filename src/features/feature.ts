import { VNode } from 'preact'
import { FeatureRecord, FeatureType, ImageMode, KeyFrame, MeshedFeatureRecord, NonMeshedFeatureRecord } from '../../common/messages/feature'
import { currentVersion, defaultVersion, deprecated } from '../../common/version'
import { app } from '../../web/src/state'
import Avatar from '../avatar'
import type Connector from '../connector'
import type Parcel from '../parcel'
import { rebindGizmosBoundToFeature } from '../tools/gizmos'
import { easingFunctions, easingModes, FeatureEditor, FeatureEditorProps } from '../ui/features'
import FeatureBasicGUI from '../ui/gui/gui'
import { inspectFeature } from '../ui/inspect-feature'
import { enterAuthoring } from '../store'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { getTransformVectorsRelativeToNode } from '../utils/feature'
import { axisNames2D, axisNames3D, bboxCompletelyWithin, tidyURL, tidyVec3, XYZ } from '../utils/helpers'
import { TimeOfDay } from '../utils/time-of-day'
import Group from './group'
import { boundingBoxOfMesh } from './utils/bounding-box'

/**
 * Special data type passed to onClick handlers
 */
export type FeatureEvent = {
  normal: number[]
  point: number[]
}

/**
 * Mesh that exports a feature click-handler used by this class
 * Never instantiated, but casted-to in some cases.
 */
export type MeshExtended = BABYLON.Mesh & NodeExtensionProps

type TransformNodeExtended = BABYLON.TransformNode & NodeExtensionProps

export type AbstractMeshExtended = BABYLON.AbstractMesh & NodeExtensionProps

// used to extend mesh, abstract mesh, transform node
type NodeExtensionProps = {
  feature?: Feature | undefined
  parcel?: Parcel | undefined
  cvOnLeftClick?: (a?: BABYLON.PickingInfo | null) => void
}

export type FeatureTrigger = {
  onTrigger: () => void
  onUnTrigger?: () => void
  timerLength?: number
  proximityToTrigger?: number
  triggered?: boolean
  handler?: (scene: BABYLON.Scene) => void
}

const EPSILON = 0.01

export const MATRIX_TRANSFORM_KEYS = new Set(['position', 'scale', 'rotation', 'collidable'])

export enum TransparencyMode {
  Ignore = 'Ignore',
  AlphaBlend = 'AlphaBlend',
  AlphaTest = 'AlphaTest',
  Background = 'Background',
}

export interface transformVectors {
  rotation: BABYLON.Vector3
  position: BABYLON.Vector3
  scaling: BABYLON.Vector3
}

type EntityType = 'material' | 'mesh' | 'texture' | 'parent' | 'light' | 'instance'

const updatingThesePropsDoesntRequireRegenerate = new Set(['position', 'scale', 'rotation', 'volume'])
// todo props type
const updateRequiresRegenerate = (props: Record<string, any>) => Object.keys(props).some((key) => !updatingThesePropsDoesntRequireRegenerate.has(key))

export default abstract class Feature<Description extends FeatureRecord = FeatureRecord> extends TypedEventTarget<{
  updated: boolean
  dragged: boolean
}> {
  static proximityToTrigger = 1.77 //distance from feature centre to trigger animation
  static timerLength = 100 //how long (milliseconds) to be close to feature to trigger animation
  static Editor: any // todo type this
  static layer: BABYLON.HighlightLayer
  parent: BABYLON.TransformNode | null = null
  uuid: string
  scene: BABYLON.Scene
  mesh?: AbstractMeshExtended | TransformNodeExtended | null
  description: Description
  parcel: Parcel
  onEnter?: () => void
  onExit?: () => void
  recentlySpawned = false
  animation?: BABYLON.Animation
  _animationDisabled = false
  timer?: number
  disposed = false
  basicGui?: FeatureBasicGUI | null
  createdByScripting = false // if feature has been created by scripting, so we can clean it on reload
  _triggers: Set<FeatureTrigger> = new Set()
  gizmos: BABYLON.Gizmo[] = []
  private _isPickable: boolean = true
  public afterSetCommon?: () => void
  protected abortController = new AbortController()
  private animationInstance: BABYLON.Animatable | undefined = undefined

  constructor(scene: BABYLON.Scene, parcel: Parcel, uuid: string, description: Description) {
    super()
    this.scene = scene
    this.parcel = parcel
    this.uuid = uuid
    this.createdByScripting = !!description.createdByScripting
    delete description.createdByScripting
    this.description = description
    this.description.version = this.description.version || defaultVersion
    this.description.uuid = uuid
  }

  get groupId(): string | null {
    const persistedGroupId = this.description.groupId
    if (!persistedGroupId) return null
    // check that the group exists- if not, groupId is null.
    return this.parcel.featuresList.some((feature) => feature.uuid === persistedGroupId) ? persistedGroupId : null
  }

  get mostParent(): Feature {
    return this.group ? this.group.mostParent : this
  }

  get isInCurrentParcel() {
    return this.parcel.id === this.parcel.grid?.currentParcel()?.id
  }

  get behaviours() {
    return this.parcel.behaviours
  }

  get blendMode(): ImageMode {
    if (this.description.blendMode) {
      return this.description.blendMode
    }
    if (this.description.inverted) {
      return 'Screen'
    }
    return 'Multiply'
  }

  get isAnimated(): boolean {
    if (this.description.animation?.keyframes.length) return true
    if (this.group) return this.group.isAnimated
    return false
  }

  get animationDisabled(): boolean {
    return this._animationDisabled
  }

  set animationDisabled(value: boolean) {
    this._animationDisabled = value
    if (this.mesh) {
      if (this._animationDisabled) {
        this.scene.stopAnimation(this.animation)
        this.animationInstance = undefined
      } else {
        this.startAnimation(true)
      }
    }
  }

  get group(): Group | undefined {
    if (!this.groupId) {
      //No point iterating through a list of features if we have no group
      return undefined
    }
    if (this.groupId === this.uuid) {
      //If the group is the feature itself, then it is not a group
      return undefined
    }
    return this.parcel.featuresList.find((feature) => feature?.uuid === this.groupId) as Group | undefined
  }

  get isLink() {
    // Links must include http or https plus some exceptions for jin
    return this.description.link && this.description.link.toString().match(/^(https*|vrchat|hifi|steam):\/\//)
  }

  get isWorldLink() {
    return this.isLink && this.description.link?.toString().match(/^https*:\/\/(localhost:9000|www.cryptovoxels.com|www.voxels.com|voxels.com|cryptolocal:9000|cryptovoxels.local:9000)\/play/)
  }

  /**
   * Whether this feature is pickable in the scene
   * Checks the mesh's isPickable property first, then checks the feature's isPickable property. i.e. the mesh's isPickable takes precedence.
   */
  get isPickable(): boolean {
    if (this.mesh && 'isPickable' in this.mesh) {
      // If the mesh has its own isPickable property, use it. BUT if the mesh is clickable, check if the feature has a isPickable false.
      return this.mesh?.isPickable ? this._isPickable : false
    }

    return this._isPickable
  }

  set isPickable(value: boolean) {
    this._isPickable = value
  }

  /**
   * Checks if the link includes time=...
   * if true, it returns object {time:'night'} or {time:'day'}
   * else, it returns false
   */
  get linkHasTimeFlag(): TimeOfDay | undefined {
    if (!this.isLink) {
      return undefined
    }
    const urlParams = new URLSearchParams(this.description.link?.toString().replace(/^.+?\?/, ''))
    const time = urlParams.get('time')
    switch (time) {
      case 'day':
        return TimeOfDay.Day
      case 'night':
        return TimeOfDay.Night
    }
    return undefined
  }

  /**
   * Checks if the link includes coords=...
   *
   */
  get linkHasCoords(): boolean {
    if (!this.isLink) {
      return false
    }
    const urlParams = new URLSearchParams(this.description.link?.toString().replace(/^.+?\?/, ''))
    const coords = urlParams.get('coords')
    return !!coords
  }

  get serialize(): Description {
    return Object.assign({}, this.description)
  }

  get audio() {
    return window._audio
  }

  get type(): Description['type'] {
    return this.description.type
  }

  get script() {
    return this.description.script || ''
  }

  get url() {
    return tidyURL(this.description.url)
  }

  get tidyPosition(): [number, number, number] {
    return tidyVec3(this.description.position)
  }

  get tidyRotation(): [number, number, number] {
    const rot = tidyVec3(this.description.rotation)

    // Round angles that are very close to increments of 45 degrees to that exact angle
    // tidies up the gaps caused by the historic restriction of radian anges to 2dp
    const round = (radian: number): number => {
      if (radian) {
        const segments = (radian * 4) / Math.PI
        const rounded = Math.round(segments)
        if (segments != rounded && Math.abs(segments - rounded) < 0.01) {
          return (rounded * Math.PI) / 4
        }
      }
      return radian
    }

    return [round(rot[0]), round(rot[1]), round(rot[2])]
  }

  get rotation() {
    return BABYLON.Vector3.FromArray(this.tidyRotation)
  }

  get scale() {
    return BABYLON.Vector3.FromArray(this.tidyScale)
  }

  get tidyScale(): [number, number, number] {
    return tidyVec3(this.description.scale)
  }

  get position() {
    return BABYLON.Vector3.FromArray(this.tidyPosition)
  }

  /**
   * Returns the position relative to its parent group
   */
  get positionInGroup(): BABYLON.Vector3 | null {
    if (!this.group || !this.group.mesh) return null
    return this.getTransformVectorsRelativeToNode(this.group.mesh).position
  }

  /**
   * Returns the position relative to its owner parcel
   */
  get positionInParcel() {
    if (this.group) {
      if (this.mesh) {
        return this.mesh.absolutePosition.subtract(this.parcel.transform.absolutePosition)
      }
      // if the item is regenerating and the mesh is not there yet
      const groupTransformNode = this.group.mesh

      const meshReplicaTransform = new BABYLON.TransformNode('meshReplicaTransform', this.scene)
      meshReplicaTransform.position.copyFrom(this.position)
      meshReplicaTransform.rotation.copyFrom(this.rotation)
      meshReplicaTransform.scaling.copyFrom(this.scale)

      meshReplicaTransform.parent = groupTransformNode ?? null

      meshReplicaTransform.computeWorldMatrix()

      const result = meshReplicaTransform.absolutePosition.subtract(this.parcel.transform.absolutePosition)
      meshReplicaTransform.dispose()
      return result
    }

    // not grouped
    // no mesh, the item could be regenerating
    if (!this.mesh) {
      return this.position.clone()
    }

    // Simple case of ungrouped features
    if (this.mesh?.parent?.metadata?.isParcel) {
      return this.mesh.position.clone()
    }

    // if thrown, fix the fxn.
    throw new Error(`positionInParcel: unable to calculate position for feature ${this.type}`)
  }

  get positionInGrid() {
    const p = this.positionInParcel
    p.addInPlace(this.parcel.transform.position)
    return p
  }

  get absolutePosition() {
    if (this.mesh) {
      return this.mesh?.absolutePosition
    } else {
      return this.parcel.transform.absolutePosition.add(this.position)
    }
  }

  get withinBounds(): boolean {
    return this.inside(this.parcel.featureBounds)
  }

  get withinHardBounds(): boolean {
    return this.inside(this.parcel.hardFeatureBounds)
  }

  get withinParcel(): boolean {
    return this.inside(this.parcel.exteriorBounds)
  }

  get isAnInstance() {
    return this.mesh instanceof BABYLON.InstancedMesh
  }

  get boundingBox(): BABYLON.BoundingBox | null {
    if (!this.mesh) {
      return null
    }
    return this.mesh && boundingBoxOfMesh(this.mesh as BABYLON.AbstractMesh) // todo fix
  }

  protected get connector(): Connector {
    return window.connector
  }

  protected get avatar(): Avatar | undefined {
    return window.persona.avatar
  }

  abstract scaleAxes(): XYZ[]

  // UI preference (in-memory, not persisted): keep aspect ratio when scaling. Drives the editor's lock
  // checkbox AND the in-world corner-resize handles so they agree. Subclasses can default it on.
  scaleAspectLocked?: boolean

  abstract nudge(): number | null

  abstract legacyNudge(): number | null

  toString() {
    return `[${this.constructor.name.toLowerCase()}]`
  }

  updateAfterWorldOffsetChange = () => {
    // virtual
  }

  shouldBeInteractive() {
    if (!this.mesh) {
      return false
    }
    const hasBehaviours = ((this.description as any).behave?.length ?? 0) > 0
    return !!this.isLink || hasBehaviours || (!!this.script && !!this.script.match(/on\('click'/g))
  }

  refreshWorldMatrix() {
    if (this.isAnimated) {
      this.mesh?.isWorldMatrixFrozen && this.mesh?.unfreezeWorldMatrix()
      this.parent?.unfreezeWorldMatrix()
    } else {
      this.mesh?.freezeWorldMatrix()
      this.parent?.freezeWorldMatrix()
    }
  }

  inside(checkBoundingBox: BABYLON.BoundingBox): boolean {
    return !this.boundingBox || bboxCompletelyWithin(checkBoundingBox, this.boundingBox)
  }

  // used by parcel-script
  playAnimation(animations: Array<BABYLON.Animation>) {
    if (!this.mesh) {
      return
    }

    this.mesh.unfreezeWorldMatrix()

    const frames = Math.max(...animations.map((animation) => animation.getHighestFrame()))

    this.mesh.animations = animations
    this.scene.beginAnimation(this.mesh, 0, frames, false)
  }

  addEvents(mesh?: TransformNodeExtended) {
    if (this.disposed) {
      console.debug(`${this.type} at ${this.parcel.id} has been disposed before addEvents called`)
      return
    }
    if (!mesh && this.mesh) {
      mesh = this.mesh
    }
    if (!mesh) {
      throw new Error('No mesh to add events to')
    }

    mesh.cvOnLeftClick = (pickInfo: BABYLON.PickingInfo | null | undefined) => {
      const point: BABYLON.FloatArray = []
      const normal: BABYLON.FloatArray = []

      if (pickInfo?.pickedPoint) {
        pickInfo.pickedPoint.subtract(this.parcel.transform.position).toArray(point)
        pickInfo.getNormal()?.toArray(normal)
      }

      this.onClick({ point, normal })
    }
  }

  removeFromGroup = () => {
    this.group?.sendChildToGrandparents(this)
  }

  openEditor() {
    if (this.parcel.canEdit && window.ui) {
      const ui = window.ui

      enterAuthoring(this.parcel.id)
      ui.activeTool = window.ui.featureTool
      // todo sort this shit
      ui.openEditor((this.constructor as any).Editor, this)
      ui.featureTool.highlightFeature(this)
    }
  }

  public onClick(_event: FeatureEvent) {
    // Default implementation - override in subclasses
  }

  checkCanNerf(): boolean {
    const currentParcel = this.parcel.grid.nearestEditableParcel()
    return currentParcel?.isExternalFeatureInParcel(this) || false
  }

  // just call this on the group if there is one
  onContextClick(e?: FeatureEvent): boolean {
    // if (this.group) {
    //   return this.group.onContextClick(e)
    // }

    if (this.parcel.canEdit) {
      this.openEditor()
      return true
    }

    if (app.state.moderator || this.checkCanNerf()) {
      this.inspect()
      return true
    }

    return false
  }

  afterUserChange() {
    // noop
  }

  onClickLink(url: string) {
    // We have a time flag in the world link
    if (this.isWorldLink && this.linkHasTimeFlag && !window.config.isSpace) {
      const time = this.linkHasTimeFlag
      if (window.environment && window.environment.timeOfDay !== time) {
        window.environment.timeOfDay = time
      }
      if (this.linkHasCoords) {
        // We also have coords
        window.persona.teleport(url)
      }
      return
    }

    if (this.isWorldLink && this.linkHasCoords && !window.config.isSpace) {
      window.persona.teleport(url)
      return
    }
    window.ui?.openLink(url)
  }

  addScriptTriggers() {
    // only add trigger watching when isTrigger enabled
    if (!this.description.isTrigger) {
      return
    }

    this.addTrigger({ onTrigger: () => this.trigger(), proximityToTrigger: this.description.proximityToTrigger })
  }

  removeAllTriggers() {
    Array.from(this._triggers).forEach((featureTrigger) => {
      this._triggers.delete(featureTrigger)
      if (featureTrigger.handler) {
        this.scene.onAfterRenderObservable.removeCallback(featureTrigger.handler)
      }
    })
  }

  addTrigger(featureTrigger: FeatureTrigger) {
    this._triggers.add(featureTrigger)

    let timer: number | undefined

    featureTrigger.handler = (scene: BABYLON.Scene) => {
      // only check every 6 frame (1000ms/60fps)*6frames = 100ms
      if (!(scene.getFrameId() % 6)) {
        return
      }

      if (!this.mesh) {
        if (this.timer) {
          clearTimeout(this.timer)
        }
        return
      }

      const avatarPos = this.avatar?.absolutePosition
      if (!avatarPos) {
        return
      }

      const distance = BABYLON.Vector3.Distance(this.mesh.absolutePosition, avatarPos)
      const proximityToTrigger = featureTrigger.proximityToTrigger || Feature.proximityToTrigger

      if (featureTrigger.triggered && distance > proximityToTrigger) {
        clearTimeout(timer)
        featureTrigger.triggered = false
        featureTrigger.onUnTrigger && featureTrigger.onUnTrigger()
      } else if (!featureTrigger.triggered && distance <= proximityToTrigger) {
        clearTimeout(timer)
        featureTrigger.triggered = true
        timer = window.setTimeout(() => {
          featureTrigger.onTrigger()
        }, Feature.timerLength)
        // set the timer
        this.timer = timer
      }
    }
    this.mesh?.computeWorldMatrix(true)

    this.scene.onAfterRenderObservable.add(featureTrigger.handler)

    return featureTrigger
  }

  trigger() {
    if (!this.description.isTrigger) {
      return
    }
    if (this.behaviours) {
      this.behaviours.dispatch(this.uuid, 'trigger')
    }
    !!this.description.triggerIsAudible && this.playSound(0)
  }

  inspect() {
    inspectFeature(this)
  }

  playSound(id: number) {
    this.parcel.playSound(id, this)
  }

  /**
   * Set the state of the currently opened Editor
   * @param {object} props An object reflecting a state of the editor.
   * @returns void
   */
  setEditorState(props: Record<string, any>) {
    // todo tighter types here
    if (!FeatureEditor.openedEditor || !this.uuid) {
      // If editor is not open, no point updating state
      return
    }
    if (FeatureEditor.openedEditor.props.feature?.description.uuid !== this.uuid) {
      // We only allow a setState of the currently opened feature.
      return
    }
    const state: Partial<FeatureEditorProps> = {}
    for (const property in props) {
      // Only change the state of properties that have changed.
      if (FeatureEditor.openedEditor.state[property] == props[property]) {
        continue
      }
      state[property as keyof FeatureEditorProps] = props[property]
    }
    if (Object.keys(state).length == 0) {
      // Do not setState if no state to set.
      return
    }
    FeatureEditor.setOpenedEditorState(state)
  }

  public abstract whatIsThis(): string | VNode<Feature>

  allowedProposedPosition(proposedPosition: BABYLON.Vector3): boolean {
    return this.wouldBeInBoundsIfMoved(proposedPosition) || this.proposedPositionCloserToParcelCenter(proposedPosition)
  }

  /**
   * Is the proposed position closer to parcel centre than the current position?
   * @proposedPosition position in local space eg. feature.description.position eg. the position displayed in the text input
   */
  proposedPositionCloserToParcelCenter = (point: BABYLON.Vector3) => {
    if (!this.mesh) {
      return false
    }
    const pointMesh = getMeshReplicaTransform(this.mesh)

    pointMesh.position = point
    pointMesh.computeWorldMatrix()

    const parcelCenter = this.parcel.boundingBox.centerWorld
    // check if point is closer to parcel centre than this.mesh current position
    const result = pointMesh.absolutePosition.subtract(parcelCenter).lengthSquared() < this.mesh.absolutePosition.subtract(parcelCenter).lengthSquared()
    pointMesh.dispose()
    return result
  }

  /**
   * Translate the feature position by the vector in its local space and return the resulting coordinate in parcel
   */
  localTranslationInParcelSpace(translation: BABYLON.Vector3) {
    if (!this.mesh) {
      return BABYLON.Vector3.Zero()
    }
    let vec = BABYLON.Vector3.TransformNormal(this.mesh.getPositionExpressedInLocalSpace().add(translation), this.mesh._localMatrix)

    let parent: BABYLON.Node | null = this.mesh
    while (true) {
      parent = parent.parent

      if (!parent || !(parent instanceof BABYLON.TransformNode)) {
        throw new Error("feature: Can't get the parcelMatrix() of a mesh not descending from a parcel mesh")
      }
      if (parent.metadata?.isParcel) {
        break
      }

      vec = BABYLON.Vector3.TransformCoordinates(vec, parent._localMatrix)
    }
    return vec
  }

  update(props: Partial<Description>) {
    Object.assign(this.description, props)

    updateRequiresRegenerate(props) ? this.regenerate() : this.setCommon()
  }

  set(props: Partial<Description>) {
    if (Object.keys(props).length == 0) {
      // If the object is empty don't send an update to the server
      return
    }
    this.update(props)
    this.sendToServer(Object.keys(props) as Array<keyof Description>)

    this.dispatchEvent(createEvent('updated', true))
    if (this.type === 'lantern') this.parcel.relight()
  }

  public abstract generate(): Promise<void>

  disposeBasicGui() {
    if (this.basicGui) {
      this.basicGui.dispose()
      this.basicGui = null
    }
  }

  async regenerate(): Promise<void> {
    if (this.mesh instanceof BABYLON.Mesh && this.mesh.instances.length > 0) {
      // if you are editing the root object, deinstance all the other items otherwise they will be destroyed
      this.deinstance()
    }

    this.dispose()
    // reset disposal state in order to regenerate
    this.disposed = false
    this.abortController = new AbortController()
    await this.generate()
    // mesh has been replaced, so we must bind the gizmo to the new mesh
    rebindGizmosBoundToFeature(this)
  }

  dispose() {
    this._dispose()
  }

  _dispose() {
    this.disposed = true
    this.abortController.abort('ABORT:Feature disposed')
    if (this.mesh) {
      if (this.mesh.animations) {
        this.scene.stopAnimation(this.mesh)
      }

      if (this.mesh instanceof BABYLON.AbstractMesh) {
        const material = this.mesh.material
        this.mesh.material = null
        this.mesh.dispose()
        this.mesh = null
        if (material instanceof BABYLON.StandardMaterial && material.getBindedMeshes().length <= 1) {
          material?.dispose(false, true)
        }
      }
    }
    this.disposeBasicGui()

    if (this.parent) {
      this.parent.dispose()
    }

    this.removeAllTriggers()
    // remove trigger timeout if existant
    this.timer && clearTimeout(this.timer)
  }

  sendToServer(onlyInclude?: Array<keyof Description>) {
    if (!this.parcel) {
      console.error('refusing to save a feature without a parcel')
      return
    }

    const lastVersion = this.description.version
    this.description.version = currentVersion

    let patch: Partial<FeatureRecord> = this.description

    // if requested, only include specific attributes
    if (onlyInclude) {
      patch = onlyInclude.reduce((result, key) => {
        result[key] = this.description[key]
        return result
      }, {} as Partial<Description>)

      if (lastVersion !== currentVersion) {
        // keep the server up to date with the latest version of the client used to update this feature
        patch['version'] = currentVersion
      }
    }

    if (!onlyInclude) {
      const fi = this.parcel.features.findIndex((f) => f?.uuid === this.uuid)
      if (fi >= 0) Object.assign(this.parcel.features[fi], patch)
      else this.parcel.features.push({ ...patch, uuid: this.uuid } as FeatureRecord)
    }

    this.parcel.sendPatch({
      features: {
        [this.uuid]: patch,
      },
    })
  }

  receiveState(state: Record<string, any>) {
    // virtual
  }

  public async generateInstance(root: Feature) {
    //virtual
  }

  getOtherInstances(): Feature[] {
    if (this.mesh instanceof BABYLON.Mesh) {
      return this.mesh.instances
        .map((x) => {
          return (x as unknown as MeshExtended).feature
        })
        .filter((x) => x !== undefined) as Feature[]
    } else if (this.mesh && (this.mesh as any) instanceof BABYLON.InstancedMesh) {
      const instMesh = this.mesh as BABYLON.InstancedMesh & { sourceMesh: MeshExtended }
      if (!instMesh.sourceMesh.feature) return []

      return [instMesh.sourceMesh['feature']].concat(instMesh.sourceMesh.instances.filter((m) => m !== this.mesh).map((m) => (m as any)['feature']))
    } else {
      return []
    }
  }

  deinstance() {
    this.getOtherInstances().forEach((feature) => {
      feature.regenerate()
    })
  }

  public delete() {
    const isLantern = this.type === 'lantern'
    const isShowbox = this.type === 'showbox'
    this.deinstance()
    this.dispose()
    this.budgetUnconsume()
    window.main?.pump.dropFeature(this.parcel.id, this.uuid)
    this.sendDeletePatch()
    this.group?.deleteIfNoChildren()
    if (isShowbox) {
      this.parcel.featuresList.forEach((f) => {
        if (f?.type === 'showbox') (f as any).reconcileActiveStream?.()
      })
    }
    if (isLantern) this.parcel.relight()
  }

  budgetUnconsume = () => {
    const i = this.parcel.featuresList.indexOf(this)

    if (i > -1) {
      this.parcel.budget.unconsume(this)
      this.parcel.featuresList.splice(i, 1)
    }
    const fi = this.parcel.features.findIndex((f) => f?.uuid === this.uuid)
    if (fi > -1) this.parcel.features.splice(fi, 1)
  }

  sendDeletePatch() {
    this.parcel.sendPatch({
      features: {
        [this.uuid]: null,
      },
    })
  }

  addAnimation() {
    if (this.animationDisabled) return
    if (this.disposed) {
      console.debug(`${this.type} at ${this.parcel.id} has been disposed before addAnimation called`)
      return
    }

    if (!this.mesh) throw new Error("Can't animate without a mesh")

    // todo - check valid destination
    if (!this.description.animation?.destination) {
      return
    }
    if (this.description.animation?.keyframes?.length === 0) {
      return
    }

    const valid = (x: unknown) => x !== undefined && x !== null && !isNaN(Number(x))

    type validFrame = { frame: number; value: [number, number, number] }
    // check all keyframes are valid
    const validKeys: validFrame[] = this.description.animation.keyframes
      .filter((k: KeyFrame) => {
        return valid(k.frame) && k.value.filter(valid).length === 3
      })
      .map((k: KeyFrame): validFrame => {
        return { frame: Number(k.frame), value: [Number(k.value[0]), Number(k.value[1]), Number(k.value[2])] }
      })

    // need at least two keyframes to animate
    if (validKeys.length < 2) {
      return
    }

    const lastFrame = validKeys[validKeys.length - 1]?.frame
    if (!lastFrame) {
      return
    }

    // check that the frame numbering is in ascending order
    if (validKeys.find((k: validFrame) => k.frame > lastFrame)) {
      return
    }

    const offset = this.description.animation.destination === 'position' ? this.position : BABYLON.Vector3.Zero()
    const keys = validKeys.map((k: validFrame) => ({ frame: k.frame, value: BABYLON.Vector3.FromArray(k.value).addInPlace(offset) }))

    this.animation = new BABYLON.Animation('feature/animation', this.description.animation.destination, 30, BABYLON.Animation.ANIMATIONTYPE_VECTOR3, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE)
    this.animation.setKeys(keys)

    const easingDescription = this.description.animation.easing
    if (easingDescription && 'function' in easingDescription) {
      const easing = easingFunctions[easingDescription.function](easingModes[easingDescription.mode])
      easing && this.animation.setEasingFunction(easing)
    }

    this.mesh.animations = [this.animation]

    this.animationInstance = this.scene.beginAnimation(this.mesh, 0, lastFrame, true)
    this.animationInstance.goToFrame(lastFrame % this.scene.getFrameId())
  }

  startAnimation = (reset = false) => {
    // ensure that all animations play in sync
    if (reset) {
      this.scene.stopAnimation(this.animation)
      this.animationInstance = undefined
      this.addAnimation()
    } else {
      this.animationInstance?.restart()
    }
  }

  pauseAnimation = () => {
    this.animationInstance?.pause()
  }

  // if we want to change the parent, but preserve the screen appearance, use this function to find what the feature's transforms should be updated to.
  public getTransformVectorsRelativeToNode(node: BABYLON.Node): transformVectors {
    if (!this.mesh) {
      const rotation = new BABYLON.Vector3()
      const position = new BABYLON.Vector3()
      const scaling = new BABYLON.Vector3()
      return { rotation, position, scaling }
    }

    return this.stripMeshAdjustments(getTransformVectorsRelativeToNode(this.mesh, node))
  }

  protected applyMeshTransformAdjustments() {}

  protected stripMeshAdjustments(tv: transformVectors): transformVectors {
    return tv
  }

  deprecatedSince(releaseVersion: any) {
    if (this.description.version) {
      return deprecated(this.description.version, releaseVersion)
    }
    return false
  }

  /**
   * Returns a unique name; to be used for creating meshes, node, materials.
   */
  protected uniqueEntityName(type: EntityType): `feature/${FeatureType}/${EntityType}/${string}` {
    return `feature/${this.type}/${type}/${this.uuid}`
  }

  protected setCommon() {
    if (this.disposed) {
      console.debug(`${this.type} at ${this.parcel.id} has been disposed before setCommon called`)
      return
    }

    // Create parent
    if (!this.parent) {
      this.parent = new BABYLON.TransformNode('feature/parent', this.scene)
    }

    // this.parent business is only used by nft-image- since nft-image has two separate meshes
    // refactor nft-image to merge the meshes so that we don't need to make this special consideration
    this.parent.position.copyFrom(this.position)
    this.parent.rotation.copyFrom(this.rotation)

    if (this.mesh) {
      // Set parent
      const group1 = this.groupId && this.parcel.getFeatureByUuid(this.groupId)
      this.mesh.setParent(group1 && group1.mesh ? group1.mesh : this.parcel.transform)

      this.mesh.scaling.set(this.scale.x || EPSILON, this.scale.y || EPSILON, this.scale.z || EPSILON)
      this.mesh.position.copyFrom(this.position)
      this.mesh.rotation.copyFrom(this.rotation)
      // In Babylon 5.5.6, a fix to computeWorldMatrix introduced something that broke the way we deal with nudges and z-fighting;
      // So now we have to always mark the mesh as dirty :/
      this.mesh.markAsDirty()
      // Behaviour of nudging before 8.10.0, where the nudge is impacted by the scale. This affects placements and parcels have been designed on the assumption
      // that it exists. In a bugfix to 8.10.0, we've restored the legacy behaviour for 3D artifacts but not 2D.
      if (this.legacyNudge() !== null) {
        // Extrude from the face a leetle
        this.mesh.translate(BABYLON.Axis.Z, <number>this.legacyNudge(), BABYLON.Space.LOCAL)
      } else if (this.nudge() !== null) {
        let scaledNudge = <number>this.nudge() / this.mesh.scaling.z
        // Test point - follow the nudging 5x the distance and check that it doesn't end up in a voxel
        const testPoint = this.localTranslationInParcelSpace(new BABYLON.Vector3(0, 0, scaledNudge * 5))

        // If there is a voxel value then we have nudged the centrepoint into a solid voxel, reverse the nudge
        const voxelValue = this.parcel.voxelValueFromPositionInParcel(testPoint) || 0
        if (voxelValue !== 0) {
          scaledNudge *= -1
        }

        // Extrude from the face a leetle - nudge is multiplied by scaling.z in world coordinates so needs to have the scaling factored in
        this.mesh.translate(BABYLON.Axis.Z, scaledNudge, BABYLON.Space.LOCAL)

        // Make x & y slightly bigger so that boxes made from nudged flat surfaces still touch corners
        if (this.nudge() !== null) {
          const nudgeGrowth = Math.abs(<number>this.nudge()) * 2
          this.mesh.scaling.addInPlaceFromFloats(nudgeGrowth, nudgeGrowth, 0)
        }
      }

      this.applyMeshTransformAdjustments()

      // TODO FIX THIS SHIT
      const clickableMesh = this.mesh as AbstractMeshExtended
      clickableMesh.feature = this
      clickableMesh.parcel = this.parcel
      clickableMesh.isPickable = true

      this.parent.parent = this.mesh.parent

      if (!this.mesh.metadata) {
        this.mesh.metadata = {}
      }

      if (this.shouldBeInteractive()) {
        const abstractMesh: AbstractMeshExtended = this.mesh as AbstractMeshExtended
        if (!(abstractMesh instanceof BABYLON.InstancedMesh)) abstractMesh.enablePointerMoveEvents = true
        this.mesh.metadata.captureMoveEvents = true
        this.mesh.metadata.isInteractive = true
      }
    }

    if (this.afterSetCommon) {
      this.afterSetCommon()
    }

    this.refreshWorldMatrix()
  }

  /**
   * If the feature was moved to this position,
   * would feature.boundingBox lie within feature.parcel.hardFeatureBounds?
   * @proposedPosition position in local space eg. feature.description.position eg. the position displayed in the text input
   */
  private wouldBeInBoundsIfMoved(proposedPosition: BABYLON.Vector3): boolean {
    if (!this.mesh || !this.boundingBox) return false

    const meshReplicaTransform = getMeshReplicaTransform(this.mesh)

    // now we have a transformNode with hierarchy matching the feature, and whose position is the proposed position
    meshReplicaTransform.position = proposedPosition
    meshReplicaTransform.computeWorldMatrix()

    const currentAbsolutePosition = this.mesh.absolutePosition
    const proposedAbsolutePosition = meshReplicaTransform.absolutePosition
    meshReplicaTransform.dispose()

    const changInAbsolutePosition = proposedAbsolutePosition.subtract(currentAbsolutePosition)

    const featureBoundingBoxVectorsWorld = this.boundingBox.vectorsWorld

    // this creates the vectors for the hypothetical bounding box if the feature was moved to proposed position
    const translatedBBVectorsWorld = featureBoundingBoxVectorsWorld.map((vector) => {
      return vector.add(changInAbsolutePosition)
    })

    // check: are all the bounding box vectors still within parcel.hardFeatureBounds?
    // if so, then the feature can be legally moved to the proposed position
    return translatedBBVectorsWorld.every((translatedBBvectorWorld) => {
      return this.parcel.pointWithinHardFeatureBounds(translatedBBvectorWorld)
    })
  }
}

/**
 * returns a transform node that has same placement
 * and hierarchy as the supplied mesh
 */
export const getMeshReplicaTransform = (mesh: BABYLON.TransformNode): BABYLON.TransformNode => {
  const meshReplicaTransform = new BABYLON.TransformNode('temp', mesh.getScene())
  meshReplicaTransform.rotation.copyFrom(mesh.rotation)
  meshReplicaTransform.position.copyFrom(mesh.position)
  meshReplicaTransform.scaling.copyFrom(mesh.scaling)
  meshReplicaTransform.parent = mesh.parent
  return meshReplicaTransform
}

abstract class MeshedFeature<Description extends MeshedFeatureRecord = MeshedFeatureRecord> extends Feature<Description> {
  mesh?: MeshExtended
}

export abstract class Feature2D<Description extends MeshedFeatureRecord> extends MeshedFeature<Description> {
  scaleAxes(): XYZ[] {
    return axisNames2D
  }

  nudge(): number | null {
    return -0.002
  }

  legacyNudge(): number | null {
    return -0.01
  }
}

export abstract class Feature3D<Description extends MeshedFeatureRecord> extends MeshedFeature<Description> {
  scaleAxes(): XYZ[] {
    return axisNames3D
  }

  nudge(): number | null {
    return -0.002
  }

  legacyNudge(): number | null {
    return -0.01
  }
}

export abstract class NonMeshedFeature<Description extends NonMeshedFeatureRecord = NonMeshedFeatureRecord> extends Feature<Description> {
  mesh?: TransformNodeExtended

  scaleAxes(): XYZ[] {
    return axisNames3D
  }

  nudge(): number | null {
    return 0
  }

  legacyNudge(): number | null {
    return null
  }
}
