import { v7 as uuid } from 'uuid'
import { signal } from '@preact/signals'
import { CollidableFeatureRecord } from '../../common/messages/feature'
import { PanelType } from '../../web/src/components/panel'
import { app } from '../../web/src/state'
import Avatar from '../avatar'
import Connector from '../connector'
import Controls from '../controls/controls'
import { FeatureTemplate } from '../features/_metadata'
import type { createFeature as _createFeature } from '../features/create'
import { getAxes } from '../features/create'
import { AbstractMeshExtended, default as Feature, Feature2D, getMeshReplicaTransform, default as MeshedFeature, MeshExtended } from '../features/feature'
import Group from '../features/group'
import { boundingBoxOfMesh } from '../features/utils/bounding-box'
import type Grid from '../grid'
import type Parcel from '../parcel'
import { User } from '../user'
import type { Tool } from '../user-interface'
import { distanceToAABB } from '../utils/boundaries'
import { getTransformVectorsRelativeToNode } from '../utils/feature'
import { cameraPosition } from '../utils/camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'
import { isFlatWallFeature } from './flat-wall'
import { Color3, Color4, Mesh, PickingInfo, SceneContext, StandardMaterialProps, TransformNode, Vec2, Vec3 } from '@babylonjs/lite'
import { quat, vec3 } from 'wgpu-matrix'

const OVERSIZE = 0.01
const highlightScale = vec3.create()
const highlightRot = quat.identity()
const highlightPos = vec3.create()

const SELECTION_COLORS = {
  inside: {
    fill: ([0, 0.5, 1] as Color3),
    edges: ([0, 0.5, 1, 0.9] as Color4),
  },
}

export type FeatureSelectionMode = 'inspect' | 'edit' | 'add' | 'move'

interface Selection {
  position?: Vec3
  feature?: MeshedFeature
  featureTemplate?: FeatureTemplate
  parcel?: Parcel
  mode?: FeatureSelectionMode
  axes?: Array<Vec3>
}

const centreOfPositions = (positions: Array<Array<number>>): Vec3 => {
  const p =
    positions.length === 1
      ? positions[0]
      : positions
          .reduce(
            (accumulator, position) => {
              position.forEach((coordinate, i) => {
                accumulator[i].push(coordinate)
              })
              return accumulator
            },
            [[], [], []] as [number[], number[], number[]],
          )
          .map((coordinateCollection) => {
            return (Math.max(...coordinateCollection) + Math.min(...coordinateCollection)) / 2
          })

  return vec3.fromValues(...p)
}

export default class FeatureTool implements Tool {
  scene: SceneContext
  parent: (TransformNode | null)
  grid: Grid
  selection: Selection
  secondarySelection: Record<string, Mesh>

  secondarySelectionMaterial: StandardMaterialProps
  enabled = signal(false)
  connector: Connector
  controls: Controls
  user: User

  spawnPoint: Vec3 = vec3.create()
  spawnRotation: Vec3 = vec3.create()
  lastPick: PickingInfo | null = null
  spawnFeatureLoadingMesh: Mesh | null = null
  overrideOnClick: (() => void) | undefined = undefined
  clickAction: any
  selector: Mesh

  private pointerObs: any | null = null

  onFeatureAdded: any = (undefined as any /* todo(lite): new BABYLON.Observable() */)
  featureLoadingMaterial: StandardMaterialProps = null!

  constructor(
    scene: SceneContext,
    parent: (TransformNode | null),
    grid: Grid,
    controls: Controls,
    connector: Connector,
    private readonly createFeature: typeof _createFeature,
  ) {
    this.scene = scene
    this.parent = parent
    this.grid = grid
    this.controls = controls
    this.connector = connector
    this.user = controls.user

    // this.spawnPoint
    // this.spawnRotation

    // No default block
    this.selection = {}

    this.selector = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateBox('feature/selector', { size: 1 }, this.scene) */)
    // this.selector.parent = parent
    this.selector.enableEdgesRendering()
    this.selector.edgesWidth = 0.5
    this.selector.edgesColor = SELECTION_COLORS.inside.edges
    this.selector.isPickable = false

    const selectorMaterial = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('feature/feature', this.scene) */)
    selectorMaterial.alpha = 0

    this.selector.material = selectorMaterial
    this.selector.visibility = 0

    this.createFeatureLoadingMesh()

    this.secondarySelection = {}
    this.secondarySelectionMaterial = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('feature/feature', this.scene) */)
    this.secondarySelectionMaterial.emissiveColor = SELECTION_COLORS.inside.fill
    this.secondarySelectionMaterial.alpha = 0.2
    this.secondarySelectionMaterial.blockDirtyMechanism = true

    // Bind to the object so that this can be passed directly to Bablyon observable
    this.onPointerObservable = this.onPointerObservable.bind(this)
  }

  get parcel(): Parcel | undefined {
    return this.grid.nearestEditableParcel()
  }

  get ui() {
    return window.ui
  }

  get main() {
    return window.main
  }

  setSecondarySelection = (features: Array<MeshedFeature>) => {
    this.disposeIrrelevantSecondarySelectors(features)
    this.createMissingSecondarySelectors(features)
  }

  disposeIrrelevantSecondarySelectors = (features: Array<MeshedFeature>) => {
    const featuresUUIDs = features.map((feature) => feature.uuid)
    Object.keys(this.secondarySelection).forEach((uuid) => {
      if (!featuresUUIDs.includes(uuid)) {
        this.secondarySelection[uuid].dispose()
        delete this.secondarySelection[uuid]
      }
    })
  }

  createMissingSecondarySelectors = (features: Array<MeshedFeature>) => {
    features.forEach((feature) => {
      if (!this.secondarySelection[feature.uuid]) {
        this.createSecondarySelector(feature)
      }
    })
  }

  createSecondarySelector = (feature: MeshedFeature) => {
    const boundingBox = feature.boundingBox
    if (!boundingBox) return

    const secondarySelector = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateBox(`feature/secondary-selector-${feature.uuid}`, { size: 1 }, this.scene) */)
    secondarySelector.parent = this.parent
    secondarySelector.enableEdgesRendering()
    secondarySelector.edgesWidth = 0.3
    secondarySelector.edgesColor = SELECTION_COLORS.inside.edges
    secondarySelector.isPickable = false
    secondarySelector.material = this.secondarySelectionMaterial
    secondarySelector.visibility = 1

    secondarySelector.position.copyFrom(boundingBox.centerWorld.subtract(this.parent?.position || vec3.create()))

    secondarySelector.scaling
      .copyFrom(boundingBox.maximumWorld)
      .subtractInPlace(boundingBox.minimumWorld)
      .addInPlace(vec3.fromValues(OVERSIZE, OVERSIZE, OVERSIZE))

    secondarySelector.rotation.set(0, 0, 0)
    this.secondarySelection[feature.uuid] = secondarySelector
  }

  setMode = (mode: FeatureSelectionMode) => {
    this.selection.mode = mode
  }

  setModeAdd = (featureOrFeatureTemplate: MeshedFeature | FeatureTemplate) => {
    let feature: MeshedFeature | undefined = undefined
    let featureTemplate: FeatureTemplate
    // Check if argument is a feature, if it is, we grab the template from it
    if (featureOrFeatureTemplate instanceof MeshedFeature) {
      const isChildOfGroup = !!featureOrFeatureTemplate.group

      featureTemplate = templateFromFeature(
        // At this point we have copied a feature because we have a feature instance instead of a template;
        // If the feature is inside a group, dont preserve groupId and position.
        // also worth mentioning: 'move' and 'edit' don't call setModeAdd
        isChildOfGroup
          ? {
              preserveGroupId: false,
              preservePosition: false,
            }
          : undefined,
      )(featureOrFeatureTemplate)
      feature = featureOrFeatureTemplate
    } else {
      featureTemplate = featureOrFeatureTemplate
    }
    const axes = getAxes(featureTemplate.type)
    // At this point, featureTemplate is always set, whereas feature is either undefined or feature
    this.selection = { mode: 'add', featureTemplate, axes, feature }
  }

  /**
   * Create a loading mesh dedicated to previewing the position of a feature being spawned
   * while the prematureFeature is loading
   */
  private createFeatureLoadingMesh() {
    this.spawnFeatureLoadingMesh = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateBox('feature/spawnFeatureLoadingMesh', { size: 1 }, this.scene) */)
    this.spawnFeatureLoadingMesh.isVisible = false
    this.spawnFeatureLoadingMesh.isPickable = false

    this.featureLoadingMaterial = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('feature/featureLoading', this.scene) */)
    this.featureLoadingMaterial.diffuseColor = ([0.8, 0.8, 0.8] as Color3)
    this.featureLoadingMaterial.emissiveColor = SELECTION_COLORS.inside.fill
    this.featureLoadingMaterial.alpha = 0.5
    this.spawnFeatureLoadingMesh.material = this.featureLoadingMaterial

    /**
     * Callback dedicated to animating the spawn feature loading mesh (when we're loading the prematureFeature)
     */
    const onAfterRenderAnimatePulse = (mesh: Mesh) => {
      if (mesh && mesh.isVisible) {
        // Simple pulsating effect
        ;(mesh.material as StandardMaterialProps).diffuseColor = (undefined as any /* todo(lite): new BABYLON.Color3(0.5, 0.5, 0.5).scale(0.5 + 0.5 * Math.abs(Math.sin(Date.now() * 0.003))) */)
      }
    }

    this.spawnFeatureLoadingMesh.onAfterRenderObservable.add(onAfterRenderAnimatePulse)
  }

  setModeMove = (feature: MeshedFeature) => {
    const axes = getAxes(feature.type)
    if (feature && feature.mesh && 'isPickable' in feature.mesh) {
      feature.mesh.isPickable = false
    }

    this.selection = { mode: 'move', featureTemplate: undefined, axes, feature }
  }

  onPointerObservable(eventData: any) {
    // sidebar feature editor owns the mouse (face-drag / corners / click-away). if we keep
    // handling taps here, POINTERTAP after every drag attempt runs onLeftClick -> deactivate()
    // and face-drag feels randomly dead until you re-open the editor enough times.
    if (this.ui?.state?.editor) return

    const pick = this.controls.pickForPointer(eventData.pickInfo) ?? null
    switch (eventData.type) {
      case (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERTAP */):
        // Left-click only
        if (eventData.event.button === 0) {
          this.onLeftClick(eventData.event, pick)
        }
        break

      case (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERMOVE */):
        this.onMove(eventData.event, pick)
    }
  }

  private lockListener = () => {
    if (!hasPointerLock() || this.selection.mode !== 'add') return
    const pick = this.controls.pickForPointer(null)
    if (pick) this.onMove(null!, pick)
  }

  activate() {
    if (this.pointerObs) return

    const mode = this.selection.mode
    if (mode === 'add' || mode === 'move') {
      this.scene.pointerMovePredicate = isVoxelFieldMesh
    } else {
      this.scene.pointerMovePredicate = (mesh: Mesh) => !!this.meshParcel(mesh) || mesh.name === 'avatar/collider'
    }

    this.enabled.value = true

    this.pointerObs = this.scene.onPointerObservable.add(this.onPointerObservable)
    document.addEventListener('pointerlockchange', this.lockListener)
    this.lockListener()
  }

  deactivate() {
    this.enabled.value = false

    document.removeEventListener('pointerlockchange', this.lockListener)
    if (this.pointerObs) {
      this.scene.onPointerObservable.remove(this.pointerObs)
      this.pointerObs = null
    }
    this.scene.pointerMovePredicate = this.controls.defaultPointerMovePredicate
    this.unHighlight()

    if (this._prematureFeature) {
      this._prematureFeature.dispose()
      this._prematureFeature?.group?.deleteIfNoChildren()
      this._prematureFeature = null!
    }
    if (this.spawnFeatureLoadingMesh) {
      this.spawnFeatureLoadingMesh!.isVisible = false
      this.spawnFeatureLoadingMesh!.parent = null!
    }
    this.lastPick = null
  }

  /**
   * Return the parcel of the given mesh, if one exists
   * @param mesh Return
   */
  meshParcel(mesh: AbstractMeshExtended): Parcel | undefined {
    if (!mesh.parent) {
      return undefined
    }
    if (mesh.isPickable === false) {
      return undefined
    }
    if (mesh.name === 'feature/selector') {
      return undefined
    }

    if (mesh.feature && mesh.feature.isPickable === false) {
      return undefined
    }

    if (mesh.feature && mesh.feature.type == 'megavox' && !(mesh.feature.description as CollidableFeatureRecord).collidable) {
      // We completely nerf picking of non-collidable megavox
      return undefined
    }
    const parent = mesh.parent as AbstractMeshExtended
    return parent['parcel'] || ((parent.parent && (parent.parent as AbstractMeshExtended)['parcel']) ?? undefined)
  }

  /**
   * Return the avatar of the given mesh, if it is an avatar
   * @param mesh Return
   */
  meshAvatar(mesh: Mesh): Avatar | undefined {
    if (mesh && mesh.metadata?.avatar instanceof Avatar) {
      return mesh.metadata.avatar
    }
  }

  createGroup = async (features: Array<MeshedFeature>) => {
    this.spawnPoint = centreOfPositions(
      features.map((feature) => {
        const ap = feature.absolutePosition
        return ap ? ap.subtract(feature.parcel.transform.absolutePosition).asArray() : feature.tidyPosition
      }),
    )
    this.spawnRotation = vec3.fromValues(0, 0, 0)

    const group = (await this.addFeature(Group.template)) as Group
    group.addChildren(features)
  }
  private _prematureFeature: Feature | null = null
  private async addPrematureFeature(featureTemplate: FeatureTemplate & { uuid?: string }, conserveUuid = false): Promise<void> {
    if (!this.selection.parcel) {
      this.selection.parcel = this.grid.nearestEditableParcel()
    }
    const spawnRotation = this.spawnRotation.asArray() as [number, number, number]

    this.spawnFeatureLoadingMesh!.parent = this.parcel!.transform!

    featureTemplate.position = this.spawnPoint.asArray()
    featureTemplate.rotation = spawnRotation

    const featureUuid = (conserveUuid && featureTemplate.uuid) || uuid()
    const feature: MeshedFeature = this.createFeature(this.scene, this.selection.parcel!, featureUuid, featureTemplate as any)
    this._prematureFeature = feature
    // We disable animations on the premature feature to avoid animations breaking the premature feature preview
    feature.animationDisabled = true
    this.spawnFeatureLoadingMesh!.isVisible = true

    feature
      .generate()
      .then(() => {
        // After generation, hide the loading mesh
        this.spawnFeatureLoadingMesh!.isVisible = false
        this.spawnFeatureLoadingMesh!.parent = null!
        /**
         * Disable picking on the feature being moved while in 'add' mode
         */
        if (feature.mesh) {
          feature.isPickable = false
        }
        if (this.lastPick && this.selection.mode === 'add') {
          this.updateSelectorAndSpawnPoint(this.lastPick)
          this.spawnFeatureLoadingMesh?.position.copyFrom(this.selector.position)
          this.spawnFeatureLoadingMesh?.scaling.copyFrom(this.selector.scaling)
          this.spawnFeatureLoadingMesh?.rotation.copyFrom(this.selector.rotation)
          feature.update({
            position: this.spawnPoint.asArray() as [number, number, number],
            rotation: this.spawnRotation.asArray() as [number, number, number],
          })
        }
        this.selector.computeWorldMatrix()
      })
      .catch((err) => {
        console.error('Error generating premature feature:', err)
        this.spawnFeatureLoadingMesh!.isVisible = false
        this.spawnFeatureLoadingMesh!.parent = null!
        feature.dispose()
        this.deactivate()
      })
  }

  async addFeature(featureTemplate: FeatureTemplate & { uuid?: string }, conserveUuid = false): Promise<MeshedFeature> {
    if (!this.selection.parcel) {
      throw new Error('addFeature: no parcel selected')
    }

    const spawnRotation = this.spawnRotation.asArray() as [number, number, number]
    // while setting featureTemplate.rotation defines the absolute feature rotation irrelevant to camera vector,
    // featureTemplate.rotate specifies a vector to add to the camera vector
    // used for polytext
    // if (featureTemplate.rotate) {
    // spawnRotation = spawnRotation.map((axis, i) => axis + featureTemplate.rotate![i]) as [number, number, number]
    // }

    //Delete the rotate attribute after having set the rotation so we don't accidentally reset the rotation on replicate
    // delete featureTemplate.rotate

    featureTemplate.position = this.spawnPoint.asArray()
    featureTemplate.rotation = spawnRotation

    // @see tools/feature.ts -> moveFeature()
    const featureUuid = (conserveUuid && featureTemplate.uuid) || uuid()

    const feature: MeshedFeature = this.createFeature(this.scene, this.selection.parcel, featureUuid, featureTemplate as any)

    // Wait for mesh generation before continuing
    await feature.generate()
    this.selection.parcel.featuresList.push(feature)
    this.selection.parcel.budget.consume(feature)
    feature.sendToServer()
    if (feature.type === 'lantern') this.selection.parcel.relight()

    if (feature instanceof Group && featureTemplate.children) {
      await Promise.all(
        featureTemplate.children.map((featureTemplate: any) => {
          featureTemplate.groupId = feature.uuid
          return this.addFeature(featureTemplate)
        }),
      )
    }

    this.selection.feature = feature
    feature.openEditor()

    this.onFeatureAdded.notifyObservers()

    this.updateHighlight()

    return feature
  }

  editFeature(feature?: MeshedFeature) {
    if (feature) {
      const parcel = feature.parcel
      Object.assign(this.selection, { feature, parcel })
    }

    if (this.selection.feature!.parcel?.canEdit) {
      this.selection.feature!.openEditor()
    } else {
      this.selection.feature!.inspect()
    }
  }

  onLeftClick(e: any, pickResult: PickingInfo | null) {
    if (!pickResult) return
    // pickResult pick point is null after voxel edit!

    // As well as picking a feature, you might pick an avatar
    const pickedAvatar = pickResult.pickedMesh && this.meshAvatar(pickResult.pickedMesh)

    this.deactivate()

    if (!!this.overrideOnClick) {
      this.overrideOnClick()
      // cleanup override
      this.overrideOnClick = undefined!
      return
    }

    // Clicking an avatar in edit or inspect mode opens its right-click popup
    if (pickedAvatar && (this.selection.mode === 'inspect' || this.selection.mode === 'edit')) {
      return pickedAvatar.onContextClick()
    }
    // Otherwise use default behaviours
    if (this.selection.mode === 'inspect') {
      if (this.updateSelectorAndSpawnPoint(pickResult)) {
        this.inspectFeature()
      }
    } else if (this.selection.mode === 'edit') {
      if (this.updateSelectorAndSpawnPoint(pickResult)) {
        this.editFeature()
      }
    } else if (this.selection.mode === 'move') {
      this.moveFeature()
    } else if (this.selection.mode === 'add') {
      if (!this.selection.featureTemplate) throw new Error(`(onLeftClick) can't create feature without featureTemplate`)
      this.addFeature(this.selection.featureTemplate)
    }
  }

  onMove(_e: any, pickResult: PickingInfo | null) {
    if (!pickResult) {
      return
    }

    this.lastPick = pickResult

    if (!this.updateSelectorAndSpawnPoint(pickResult)) {
      return
    }

    if (this.selection.mode === 'add') {
      if (!this._prematureFeature && this.selection.featureTemplate) {
        this.addPrematureFeature(this.selection.featureTemplate)
      }
      if (this._prematureFeature) {
        this.spawnFeatureLoadingMesh?.position.copyFrom(this.selector.position)
        this.spawnFeatureLoadingMesh?.scaling.copyFrom(this.selector.scaling)
        this.spawnFeatureLoadingMesh?.rotation.copyFrom(this.selector.rotation)
        this._prematureFeature.update({
          position: this.spawnPoint.asArray() as [number, number, number],
          rotation: this.spawnRotation.asArray() as [number, number, number],
        })
      }
    }
  }

  inspectFeature() {
    const feature = this.selection.feature
    if (feature) {
      feature.inspect()
    }
  }

  async moveFeature() {
    if (!this.selection.feature) {
      console.warn('moveFeature(): called without a feature selected')
      return
    }
    let feature = this.selection.feature

    if (feature.group) {
      const parent = feature.group

      if (!feature.mostParent.mesh) {
        throw new Error('moveFeature: parent must have a mesh')
      }

      // get a transform node representing what the feature would be like if it didn't belong to any groups.
      const ungroupedTransform = getMeshReplicaTransform(feature.mostParent.mesh)

      // update this make-believe ungrouped version of the feature using the spawn information. This means that the transform node is now centered on the place where the user clicked
      ungroupedTransform.position = this.spawnPoint
      if (parent.mesh) {
        // for our ungrouped transform node positioned on at the place the user clicked, what would its transform vectors look like if the transform node was parented to the feature's group?
        const transformVectors = getTransformVectorsRelativeToNode(ungroupedTransform, parent.mesh)

        // update the feature
        feature.set({
          position: transformVectors.position.asArray() as [number, number, number],
          rotation: transformVectors.rotation.asArray() as [number, number, number],
        })
      }
      ungroupedTransform.dispose()
      return
    }
    const props = {
      position: this.spawnPoint.asArray() as [number, number, number],
      rotation: this.spawnRotation.asArray() as [number, number, number],
    }

    if (this.selection.parcel && feature.parcel !== this.selection.parcel) {
      // feature has moved to a different parcel
      // delete and then add to other parcel
      const description = { ...feature.description, ...(feature.type == 'group' ? templateFromFeature()(feature) : {}) }
      Object.assign(description, props)
      feature.delete()
      const newFeature = await this.addFeature(description as any, true)
      if (!newFeature) {
        console.warn("Couldn't create feature in new parcel")
        return
      }
      feature = newFeature
      return
    }

    feature.set(props)
  }

  unHighlight() {
    this.selector.visibility = 0
    this.selector.parent = null!
    // note: commenting this causes secondary selection to persist through open/close panel.
    // is that the UX we want?
    // this.setSecondarySelection([])
  }

  highlight() {
    this.selector.visibility = 1
  }

  updateHighlight(mesh?: Mesh) {
    const feature = this.selection.feature
    const target = mesh ?? ((false /* todo(lite): feature?.mesh instanceof BABYLON.AbstractMesh */) ? feature.mesh : undefined)

    // flat wall features are thin rotated planes - world AABB floats off the screen.
    // match the mesh world pose; force a visible Z so scale.z=0 still outlines.
    if (feature && isFlatWallFeature(feature) && target) {
      const wm = target.computeWorldMatrix(true)
      wm.decompose(highlightScale, highlightRot, highlightPos)
      this.selector.parent = null!
      this.selector.position.copyFrom(highlightPos)
      if (!this.selector.rotationQuaternion) this.selector.rotationQuaternion = quat.identity()
      this.selector.rotationQuaternion.copyFrom(highlightRot)
      this.selector.scaling.set(Math.abs(highlightScale.x) + OVERSIZE, Math.abs(highlightScale.y) + OVERSIZE, Math.max(Math.abs(highlightScale.z) + OVERSIZE, 0.05))
      this.highlight()
      return
    }

    this.selector.parent = null!
    this.selector.rotationQuaternion = null

    const boundingBox = target ? boundingBoxOfMesh(target) : feature?.boundingBox
    if (!boundingBox) return

    this.selector.position.copyFrom(boundingBox.centerWorld)

    this.selector.scaling
      .copyFrom(boundingBox.maximumWorld)
      .subtractInPlace(boundingBox.minimumWorld)
      .addInPlace(vec3.fromValues(OVERSIZE, OVERSIZE, OVERSIZE))

    this.selector.rotation.set(0, 0, 0)
    this.highlight()
  }

  highlightFeature(feature: MeshedFeature, mesh?: Mesh) {
    const parcel = feature.parcel
    Object.assign(this.selection, { parcel, feature })
    this.updateHighlight((false /* todo(lite): feature.mesh instanceof BABYLON.AbstractMesh */) ? feature.mesh : undefined)
  }

  spawnPlaceholder(info: PickingInfo, featureTemplate: any) {
    this.deactivate()

    this.selection = {
      mode: 'add',
      featureTemplate,
    }

    if (!this.updateSelectorAndSpawnPoint(info)) {
      return
    }
  }

  spawn(info: PickingInfo, featureTemplate?: any): Promise<Feature> | null {
    // debugger

    this.selection = {
      mode: 'add',
      featureTemplate,
    }

    if (!this.updateSelectorAndSpawnPoint(info)) {
      return null
    }

    this.deactivate()

    Object.assign(this.selection, { featureTemplate })

    if (!this.selection.featureTemplate) throw new Error(`(spawn) can't create feature without featureTemplate`)
    return this.addFeature(this.selection.featureTemplate)
  }

  updateSelectorAndSpawnPoint(pickResult: PickingInfo): boolean {
    const pickedNormal = pickResult.getNormal()
    const pickedPoint = pickResult.pickedPoint
    if (!pickResult || !pickedPoint) {
      this.unHighlight()
      return false
    }

    const pickedPointRounded = roundVector3(pickedPoint.clone())

    // use the parcel of the picked feature
    const mesh = pickResult.pickedMesh as AbstractMeshExtended | null
    const pickedFeature: MeshedFeature | null = mesh && (mesh.feature ?? null)

    // inspector mode for figuring out who owns a particular feature and mod nerfing
    if (this.selection.mode === 'inspect' && pickedFeature && mesh && mesh.feature) {
      if (pickedNormal) {
        const rotation = getPlacementRotation(pickedNormal, !(pickedFeature instanceof Feature2D), pickedPointRounded, cameraPosition(this.scene))
        this.selector.rotation = rotation
      }
      this.highlightFeature(mesh.feature, mesh!)
      return true
    }

    // if there are multiple parcels, we return the one that is closest to camera
    // this means that items will change ownership from parcels that are next to each other on
    // exterior walls depending on what parcel you are standing in when you move the feature
    const cameraPos = cameraPosition(this.scene)
    const boundingParcel = this.user.getParcels(pickedPointRounded).sort((a, b) => {
      return distanceToAABB(cameraPos, a.exteriorBounds) - distanceToAABB(cameraPos, b.exteriorBounds)
    })[0]

    // if we picked a feature, just use it's parcel so that we can still edit features outside of
    // their parent parcel

    const canEditOrNerf = pickedFeature?.parcel.canEdit || pickedFeature?.checkCanNerf()
    const parcel = canEditOrNerf ? pickedFeature?.parcel : boundingParcel

    if (!parcel) {
      this.unHighlight()
      return false
    }

    if (this.selection.mode === 'edit') {
      if (!mesh || !canEditOrNerf) {
        this.unHighlight()
        return false
      }

      let feature: MeshedFeature | null = null

      if (mesh['feature']) {
        feature = mesh['feature']
      } else if (mesh.parent && (mesh.parent as AbstractMeshExtended)['feature']) {
        feature = (mesh.parent as AbstractMeshExtended)['feature'] ?? null
      }

      if (!feature) {
        this.unHighlight()
        return false
      }

      this.highlightFeature(feature)

      return true
    } else if (this.selection.mode === 'move') {
      const feature = this.selection.feature as MeshedFeature
      if (!feature || !pickedNormal) {
        this.unHighlight()
        return false
      }

      const boundingBox = feature.boundingBox
      if (!boundingBox) return false

      const rotation = getPlacementRotation(pickedNormal, featureIs3D(feature), pickedPointRounded, cameraPosition(this.scene))
      this.spawnRotation = rotation
      this.selector.rotation = rotation
      this.selector.parent = parcel!.transform!
      this.selection.parcel = boundingParcel

      const { spawnPoint, selectorCenter } = placementFromPick(pickedPointRounded, pickedNormal, rotation, boundingBox.minimum, boundingBox.maximum, feature.scale, parcel.transform.position)

      const localSize = boundingBox.maximum.subtract(boundingBox.minimum)
      this.selector.scaling.set(localSize.x + OVERSIZE, localSize.y + OVERSIZE, Math.max(localSize.z + OVERSIZE, 0.05))
      this.selector.position.copyFrom(selectorCenter)
      this.spawnPoint = spawnPoint
      this.selector.visibility = 1

      return true
    } else if (this.selection.mode === 'add') {
      if (!pickedNormal || !this.selection.featureTemplate) {
        return false
      }
      this.selector.parent = parcel!.transform!

      const bb = this.selection.feature?.boundingBox || (this._prematureFeature as MeshedFeature | null)?.boundingBox || null
      const accurateScale = getAccurateScaleGivenBoundingBox(this.selection.featureTemplate, bb)
      const featureTemplateScale = this.selection.featureTemplate.scale
      const featureScale = () => (accurateScale ? accurateScale : featureTemplateScale)
      const isFeatureTemplate3D = getAxes(this.selection.featureTemplate.type).length == 1

      let rotation = getPlacementRotation(pickedNormal, isFeatureTemplate3D, pickedPointRounded, cameraPosition(this.scene))
      if (this.selection.feature && pickedNormal.y > 0) {
        rotation = rotation.clone()
        rotation.y = this.selection.feature.rotation.y
      }

      const scale = featureScale()
      const scaleVec = vec3.fromValues(scale[0], scale[1], scale[2])
      const bounds = bb ? { min: bb.minimum, max: bb.maximum } : localBoundsForTemplate(this.selection.featureTemplate.type, scale)
      const { spawnPoint, selectorCenter } = placementFromPick(pickedPointRounded, pickedNormal, rotation, bounds.min, bounds.max, scaleVec, parcel.transform.position)

      this.selector.rotation = rotation
      const localSize = bounds.max.subtract(bounds.min)
      // zero-depth 2D templates (showbox scale.z=0) still need a visible ghost outline
      this.selector.scaling.set(localSize.x + OVERSIZE, localSize.y + OVERSIZE, Math.max(localSize.z + OVERSIZE, 0.05))
      this.selector.position.copyFrom(selectorCenter)
      this.spawnPoint = spawnPoint
      this.spawnRotation = rotation

      this.selector.visibility = 1

      Object.assign(this.selection, { parcel })

      return true
    }
    return false
  }
}

const roundVector3 = (vector: Vec3): Vec3 => {
  const roundingFunction = (value: any) => Math.round(value * 4) / 4
  vector.x = roundingFunction(vector.x)
  vector.y = roundingFunction(vector.y)
  vector.z = roundingFunction(vector.z)

  return vector
}

const isVoxelFieldMesh = (mesh: Mesh) => mesh.isVisible && mesh.isPickable && (mesh.name.startsWith('voxel-field/opaque') || mesh.name.startsWith('voxelizer/'))

// to check if the normal belongs to a wall
export const normalIsFromWall = (normal: Vec3): 'z' | 'x' | false => {
  return !!Math.abs(normal.z) ? 'z' : !!Math.abs(normal.x) ? 'x' : false
}

const HALF = Math.PI / 2

// 2D screens on floor/ceiling: stand upright, yaw toward the camera (snapped to 90deg)
const getPseudoBillboardRotation = (pickedPoint: Vec3, camPos: Vec3): Vec3 => {
  const a = ({ x: pickedPoint.x, y: pickedPoint.z } as Vec2)
  const b = ({ x: camPos.x, y: camPos.z } as Vec2)
  let yaw = Math.PI * 0.5 - (undefined as any /* todo(lite): BABYLON.Angle.BetweenTwoPoints(b, a).radians() */)
  const granularity = Math.PI / 2
  yaw = Math.round(yaw / granularity) * granularity
  return vec3.fromValues(0, yaw, 0)
}

const getPlacementRotation = (normal: Vec3, is3D: boolean, pickPoint?: Vec3, camPos?: Vec3): Vec3 => {
  if (Math.abs(normal.y) > 0) {
    if (is3D) {
      return normal.y > 0 ? vec3.fromValues(0, 0, 0) : vec3.fromValues(0, 0, Math.PI)
    }
    // showbox/image/video etc - never lay flat on the floor (invisible zero-depth plane)
    if (pickPoint && camPos) return getPseudoBillboardRotation(pickPoint, camPos)
    return vec3.create()
  }
  if (Math.abs(normal.x) > 0) {
    if (is3D) {
      return vec3.fromValues(0, 0, normal.x > 0 ? -HALF : HALF)
    }
    return vec3.fromValues(0, normal.x > 0 ? -HALF : HALF, 0)
  }
  if (is3D) {
    return vec3.fromValues(normal.z > 0 ? HALF : -HALF, 0, 0)
  }
  return vec3.fromValues(0, normal.z > 0 ? Math.PI : 0, 0)
}

const localBoundsForTemplate = (type: FeatureTemplate['type'], scale: number[]) => {
  const [sx, sy, sz] = scale
  const is3D = getAxes(type).length === 1
  if (is3D) {
    return {
      min: vec3.fromValues(-sx / 2, 0, -sz / 2),
      max: vec3.fromValues(sx / 2, sy, sz / 2),
    }
  }
  return {
    min: vec3.fromValues(-sx / 2, -sy / 2, 0),
    max: vec3.fromValues(sx / 2, sy / 2, 0),
  }
}

const placementFromPick = (
  pickPointWorld: Vec3,
  surfaceNormal: Vec3,
  rotation: Vec3,
  localMin: Vec3,
  localMax: Vec3,
  scale: Vec3,
  parcelPos: Vec3,
): { spawnPoint: Vec3; selectorCenter: Vec3 } => {
  const rotMat = (undefined as any /* todo(lite): BABYLON.Matrix.RotationYawPitchRoll(rotation.y, rotation.x, rotation.z) */)
  const scaleMat = (undefined as any /* todo(lite): BABYLON.Matrix.Scaling(scale.x, scale.y, scale.z) */)
  const mat = rotMat.multiply(scaleMat)
  const mid = (a: number, b: number) => (a + b) / 2

  const faces = [
    { center: vec3.fromValues(mid(localMin.x, localMax.x), localMin.y, mid(localMin.z, localMax.z)), outward: vec3.fromValues(0, -1, 0) },
    { center: vec3.fromValues(mid(localMin.x, localMax.x), localMax.y, mid(localMin.z, localMax.z)), outward: vec3.fromValues(0, 1, 0) },
    { center: vec3.fromValues(localMin.x, mid(localMin.y, localMax.y), mid(localMin.z, localMax.z)), outward: vec3.fromValues(-1, 0, 0) },
    { center: vec3.fromValues(localMax.x, mid(localMin.y, localMax.y), mid(localMin.z, localMax.z)), outward: vec3.fromValues(1, 0, 0) },
    { center: vec3.fromValues(mid(localMin.x, localMax.x), mid(localMin.y, localMax.y), localMin.z), outward: vec3.fromValues(0, 0, -1) },
    { center: vec3.fromValues(mid(localMin.x, localMax.x), mid(localMin.y, localMax.y), localMax.z), outward: vec3.fromValues(0, 0, 1) },
  ]

  const inward = surfaceNormal.scale(-1)
  let bestDot = -Infinity
  let contactLocal = faces[0].center
  for (const face of faces) {
    const outwardWorld = (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(face.outward, rotMat).normalize() */)
    const dot = vec3.dot(outwardWorld, inward)
    if (dot > bestDot) {
      bestDot = dot
      contactLocal = face.center
    }
  }

  const contactOffset = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(contactLocal, mat) */)
  const bboxCenterLocal = localMin.add(localMax).scale(0.5)
  const centerOffset = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(bboxCenterLocal, mat) */)
  const pivotWorld = pickPointWorld.subtract(contactOffset)

  return {
    spawnPoint: pivotWorld.subtract(parcelPos),
    selectorCenter: pivotWorld.add(centerOffset).subtract(parcelPos),
  }
}
//Returns null or an array of the actual scale of the feature
const getAccurateScaleGivenBoundingBox = (featureTemplate: FeatureTemplate, BB: any | null) => {
  if (!BB) {
    return null
  }
  const scale = featureTemplate.scale
  const width = BB.maximum.x - BB.minimum.x
  const height = BB.maximum.y - BB.minimum.y
  const depth = BB.maximum.z - BB.minimum.z

  return featureTemplate.type == 'group' ? [width, height, depth] : [width * scale[0], height * scale[1], depth * scale[2]]
}

const featureIs3D = (feature: MeshedFeature) => {
  return !(feature instanceof Feature2D)
}

type TemplateOptions = {
  preservePosition: boolean
  preserveGroupId: boolean
}

const defaultTemplateOptions = {
  preservePosition: false,
  preserveGroupId: true,
}

export const templateFromFeature =
  (options: TemplateOptions = defaultTemplateOptions) =>
  (feature: MeshedFeature): FeatureTemplate => {
    const description = { ...feature.description }
    const scale = feature.tidyScale

    // clear out stuff that doesn't belong in a template
    delete description.uuid
    delete description.version

    if (!options.preserveGroupId) {
      // dedicated to group duplication
      delete description.groupId
    }

    const template = {
      ...description,
      scale,
    } as FeatureTemplate

    if (options.preservePosition && feature.mesh) {
      template.position = feature.mesh.position.asArray()
    } else {
      delete template.position
    }

    if (feature instanceof Group) {
      // children preserve their position
      const options = {
        preservePosition: true,
        preserveGroupId: false,
      }
      template.children = feature.children.map(templateFromFeature(options))
    }

    return template
  }
