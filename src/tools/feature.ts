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
import { getAxes, pivotToBottomOfBoundingBoxDefault } from '../features/create'
import { AbstractMeshExtended, default as Feature, Feature2D, getMeshReplicaTransform, default as MeshedFeature, MeshExtended } from '../features/feature'
import Group from '../features/group'
import { boundingBoxOfMesh } from '../features/utils/bounding-box'
import type Grid from '../grid'
import type Parcel from '../parcel'
import { User } from '../user'
import type { Tool } from '../user-interface'
import { distanceToAABB } from '../utils/boundaries'
import { getTransformVectorsRelativeToNode } from '../utils/feature'
import { bboxCompletelyWithin } from '../utils/helpers'
import { cameraPosition } from '../utils/camera'
import { hasPointerLock } from '../../common/helpers/ui-helpers'

type AABB = {
  min: BABYLON.Vector3
  max: BABYLON.Vector3
}
const OVERSIZE = 0.01

const SELECTION_COLORS = {
  inside: {
    fill: new BABYLON.Color3(0, 0.5, 1),
    edges: new BABYLON.Color4(0, 0.5, 1, 0.9),
  },
  near: {
    fill: new BABYLON.Color3(0.8, 0.5, 0),
    edges: new BABYLON.Color4(0.8, 0.5, 0, 0.9),
  },
  outside: {
    fill: new BABYLON.Color3(1, 0.1, 0.1),
    edges: new BABYLON.Color4(1, 0, 0, 0.9),
  },
}

export type FeatureSelectionMode = 'inspect' | 'edit' | 'add' | 'move' | 'copy'

interface Selection {
  position?: BABYLON.Vector3
  feature?: MeshedFeature
  featureTemplate?: FeatureTemplate
  parcel?: Parcel
  mode?: FeatureSelectionMode
  axes?: Array<BABYLON.Vector3>
}

const centreOfPositions = (positions: Array<Array<number>>): BABYLON.Vector3 => {
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

  return new BABYLON.Vector3(...p)
}

export default class FeatureTool implements Tool {
  scene: BABYLON.Scene
  parent: BABYLON.TransformNode
  grid: Grid
  selection: Selection
  secondarySelection: Record<string, BABYLON.AbstractMesh>

  secondarySelectionMaterial: BABYLON.StandardMaterial
  enabled = signal(false)
  connector: Connector
  controls: Controls
  user: User

  spawnPoint: BABYLON.Vector3 = BABYLON.Vector3.Zero()
  spawnRotation: BABYLON.Vector3 = BABYLON.Vector3.Zero()
  lastPick: BABYLON.PickingInfo | null = null
  spawnFeatureLoadingMesh: BABYLON.Mesh | null = null
  overrideOnClick: (() => void) | undefined = undefined
  clickAction: any
  selector: BABYLON.Mesh

  nextMode: FeatureSelectionMode | null = null

  onFeatureAdded: BABYLON.Observable<void> = new BABYLON.Observable()
  featureLoadingMaterial: BABYLON.StandardMaterial = null!

  constructor(
    scene: BABYLON.Scene,
    parent: BABYLON.TransformNode,
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

    this.selector = BABYLON.MeshBuilder.CreateBox('feature/selector', { size: 1 }, this.scene)
    // this.selector.parent = parent
    this.selector.enableEdgesRendering()
    this.selector.edgesWidth = 0.5
    this.selector.edgesColor = SELECTION_COLORS.inside.edges
    this.selector.isPickable = false
    this.selector.checkCollisions = false

    const selectorMaterial = new BABYLON.StandardMaterial('feature/feature', this.scene)
    selectorMaterial.alpha = 0

    this.selector.material = selectorMaterial

    this.createFeatureLoadingMesh()

    this.secondarySelection = {}
    this.secondarySelectionMaterial = new BABYLON.StandardMaterial('feature/feature', this.scene)
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
    this.refreshBounds()
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

    const secondarySelector = BABYLON.MeshBuilder.CreateBox(`feature/secondary-selector-${feature.uuid}`, { size: 1 }, this.scene)
    secondarySelector.parent = this.parent
    secondarySelector.enableEdgesRendering()
    secondarySelector.edgesWidth = 0.3
    secondarySelector.edgesColor = SELECTION_COLORS.inside.edges
    secondarySelector.isPickable = false
    secondarySelector.checkCollisions = false
    secondarySelector.material = this.secondarySelectionMaterial
    secondarySelector.visibility = 1

    secondarySelector.position.copyFrom(boundingBox.centerWorld.subtract(this.parent.position))

    secondarySelector.scaling
      .copyFrom(boundingBox.maximumWorld)
      .subtractInPlace(boundingBox.minimumWorld)
      .addInPlace(new BABYLON.Vector3(OVERSIZE, OVERSIZE, OVERSIZE))

    secondarySelector.rotation.set(0, 0, 0)
    this.secondarySelection[feature.uuid] = secondarySelector
  }

  setMode = (mode: FeatureSelectionMode) => {
    this.selection.mode = mode
  }

  setModeCopy = (feature: MeshedFeature) => {
    const featureTemplate = undefined // no point creating template here, setModeAdd will do it
    const axes = getAxes(feature.type)

    // FIXME FUCK ME THIS IS GROSS
    setTimeout(() => {
      this.setModeAdd(feature)
    }, 50)

    this.selection = { mode: 'copy', featureTemplate, axes, feature }
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
    this.spawnFeatureLoadingMesh = BABYLON.MeshBuilder.CreateBox('feature/spawnFeatureLoadingMesh', { size: 1 }, this.scene)
    this.spawnFeatureLoadingMesh.isVisible = false
    this.spawnFeatureLoadingMesh.isPickable = false
    this.spawnFeatureLoadingMesh.checkCollisions = false

    this.featureLoadingMaterial = new BABYLON.StandardMaterial('feature/featureLoading', this.scene)
    this.featureLoadingMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.8)
    this.featureLoadingMaterial.emissiveColor = SELECTION_COLORS.inside.fill
    this.featureLoadingMaterial.alpha = 0.5
    this.spawnFeatureLoadingMesh.material = this.featureLoadingMaterial

    /**
     * Callback dedicated to animating the spawn feature loading mesh (when we're loading the prematureFeature)
     */
    const onAfterRenderAnimatePulse = (mesh: BABYLON.Mesh) => {
      if (mesh && mesh.isVisible) {
        // Simple pulsating effect
        ;(mesh.material as BABYLON.StandardMaterial).diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5).scale(0.5 + 0.5 * Math.abs(Math.sin(Date.now() * 0.003)))
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

  onPointerObservable(eventData: BABYLON.PointerInfo) {
    const pick = this.controls.pickForPointer(eventData.pickInfo)
    switch (eventData.type) {
      case BABYLON.PointerEventTypes.POINTERTAP:
        // Left-click only
        if (eventData.event.button === 0) {
          this.onLeftClick(eventData.event, pick)
        }
        break

      case BABYLON.PointerEventTypes.POINTERMOVE:
        this.onMove(eventData.event, pick)
    }
  }

  private lockListener = () => {
    if (!hasPointerLock() || this.selection.mode !== 'add') return
    const pick = this.controls.pickForPointer(null)
    if (pick) this.onMove(null!, pick)
  }

  activate() {
    // make sure it was already deactivated
    this.deactivate()

    // Unlock the move predicate to allow mousing over all features & avatars. May reduce drag performance while in inspect or edit mode
    this.scene.pointerMovePredicate = (mesh: BABYLON.AbstractMesh) => !!this.meshParcel(mesh) || mesh.name === 'avatar/collider'

    this.enabled.value = true

    this.scene.onPointerObservable.add(this.onPointerObservable)
    document.addEventListener('pointerlockchange', this.lockListener)
    this.lockListener()
  }

  deactivate() {
    this.enabled.value = false

    document.removeEventListener('pointerlockchange', this.lockListener)
    this.scene.onPointerObservable.removeCallback(this.onPointerObservable)
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
  meshAvatar(mesh: BABYLON.AbstractMesh): Avatar | undefined {
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
    this.spawnRotation = new BABYLON.Vector3(0, 0, 0)

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
    feature.recentlySpawned = true
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
        this.refreshBounds()
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
    feature.recentlySpawned = true

    // Wait for mesh generation before continuing
    await feature.generate()
    this.selection.parcel.featuresList.push(feature)
    this.selection.parcel.budget.consume(feature)
    feature.sendToServer()

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
    if (this.nextMode === 'move') {
      this.deactivate()

      setTimeout(() => {
        if (!this.selection.feature) {
          throw new Error(`(editFeature) can't call move without a feature`)
        }
        this.setModeMove(this.selection.feature)
        this.activate()
        this.nextMode = null
      }, 150)
      return
    }

    if (this.nextMode === 'copy') {
      this.deactivate()
      if (!this.selection.feature) {
        app.showSnackbar('No feature selected', PanelType.Danger)
        return
      }

      // Checks the budget limit for all features inside the feature (and group if it's a group)
      const budgetCheck = this.selection.feature.parcel.budget.hasBudgetForFeature(this.selection.feature)

      if (!budgetCheck.pass) {
        // Show all the feature types that reached limit
        const failedTypes = budgetCheck.types.filter((t) => !t.pass).map((t) => t.type)
        app.showSnackbar(`Limit reached for ${budgetCheck.types.length > 1 ? failedTypes.join(', ') : 'this feature'}.`, PanelType.Danger)
        return
      }

      setTimeout(() => {
        if (!this.selection.feature) {
          throw new Error(`(editFeature) can't copy without a feature`)
        }
        this.setModeAdd(this.selection.feature)
        this.activate()
        this.nextMode = null
      }, 150)
      return
    }

    if (this.selection.feature!.parcel?.canEdit) {
      this.selection.feature!.openEditor()
    } else {
      this.selection.feature!.inspect()
    }
  }

  onLeftClick(e: BABYLON.IMouseEvent, pickResult: BABYLON.PickingInfo | null) {
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

  onMove(_e: BABYLON.IMouseEvent, pickResult: BABYLON.PickingInfo | null) {
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

  /**
   * Update the color of of the selection highlight based on whether it's in/near/out of parcel bounds
   */
  refreshBounds() {
    // Colour the feature as per the current feature's parcel if there is one (move will show a feature as red if you drag to another parcel)
    // But if there isn't one (add/replicate) then just show use the selected parcel
    const parcel = this.selection.feature?.parcel || this.selection.parcel
    if (!parcel) {
      return
    }

    // The world matrix may be out of date, leading to heisenbugs
    this.selector.computeWorldMatrix()
    const objBounds: BABYLON.BoundingBox = this.selector.getBoundingInfo().boundingBox

    if (bboxCompletelyWithin(parcel.boundingBox, objBounds)) {
      this.updateSelectorsStyling(SELECTION_COLORS.inside)
    } else if (bboxCompletelyWithin(parcel.featureBounds, objBounds)) {
      this.updateSelectorsStyling(SELECTION_COLORS.near)
    } else {
      this.updateSelectorsStyling(SELECTION_COLORS.outside)
    }
  }

  updateSelectorsStyling = (selectionColors: any) => {
    // const { fill, edges } = selectionColors
    // const selectorMaterial = this.selector.material as BABYLON.StandardMaterial
    // // selectorMaterial.emissiveColor = fill
    // this.selector.edgesColor = edges
    // this.secondarySelectionMaterial.emissiveColor = fill
    // Object.values(this.secondarySelection).forEach((mesh: BABYLON.AbstractMesh) => {
    //   mesh.edgesColor = edges
    // })
  }

  private computeWorldAABB(mesh: BABYLON.AbstractMesh): AABB {
    const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)
    if (!positions) {
      throw new Error('Mesh has no vertex positions')
    }

    const worldMatrix = mesh.getWorldMatrix()
    const transformed = new BABYLON.Vector3()
    var min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    var max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

    for (let i = 0; i < positions.length; i += 3) {
      BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], worldMatrix, transformed)
      min.minimizeInPlace(transformed)
      max.maximizeInPlace(transformed)
    }

    return { min, max }
  }

  updateHighlight(mesh?: BABYLON.AbstractMesh) {
    const boundingBox = mesh ? boundingBoxOfMesh(mesh) : this.selection.feature?.boundingBox

    if (!boundingBox) return

    this.selector.position.copyFrom(boundingBox.centerWorld)

    this.selector.scaling
      .copyFrom(boundingBox.maximumWorld)
      .subtractInPlace(boundingBox.minimumWorld)
      .addInPlace(new BABYLON.Vector3(OVERSIZE, OVERSIZE, OVERSIZE))

    this.selector.rotation.set(0, 0, 0)
    this.highlight()
    this.refreshBounds()
  }

  highlightFeature(feature: MeshedFeature, mesh?: BABYLON.AbstractMesh) {
    const parcel = feature.parcel
    Object.assign(this.selection, { parcel, feature })
    this.updateHighlight(feature.mesh instanceof BABYLON.AbstractMesh ? feature.mesh : undefined)
  }

  spawnPlaceholder(info: BABYLON.PickingInfo, featureTemplate: any) {
    this.deactivate()

    this.selection = {
      mode: 'add',
      featureTemplate,
    }

    if (!this.updateSelectorAndSpawnPoint(info)) {
      return
    }
  }

  spawn(info: BABYLON.PickingInfo, featureTemplate?: any): Promise<Feature> | null {
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

  updateSelectorAndSpawnPoint(pickResult: BABYLON.PickingInfo): boolean {
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
        const rotation = getRotation(pickedPoint, pickedNormal, cameraPosition(this.scene))
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

      // if feature is inside a group, select that instead
      if (feature?.group) {
        feature = feature.group
        while (!!feature.group) {
          // We climb up the ladder of groups to select to bigDaddy group ( the root parent)
          feature = feature.group
        }
      }

      if (!feature) {
        this.unHighlight()
        return false
      }

      this.highlightFeature(feature.mostParent)

      return true
    } else if (this.selection.mode === 'move') {
      const feature = this.selection.feature as MeshedFeature
      if (!feature || !pickedNormal) {
        this.unHighlight()
        return false
      }

      const boundingBox = feature.boundingBox
      if (!boundingBox) return false

      const selectorPoint = pickedPointRounded.clone()
      const spawnPoint = pickedPointRounded.clone()

      const axes = getAxes(feature.type)

      // Special case for things on the xz plane
      if (axes && axes[0].equals(BABYLON.Axis.Y)) {
        this.selector.position.y += this.selector.scaling.y / 2
      }

      // if placing a 2D feature on the wall, then rotate it.
      if (feature instanceof Feature2D && normalIsFromWall(pickedNormal)) {
        this.spawnRotation = getRotationForWallAlignment(pickedNormal)
      } else {
        // if placing on the floor or ceiling- or placing a 3D feature anywhere, don't rotate it
        this.spawnRotation = feature.rotation!.clone()
      }

      this.selector.parent = parcel!.transform!

      // FYI- when we set the selector scaling here, the scale encapsulates the rotation the feature currently has.
      // eg- selector with rotation = 0 will match the feature in its current state- no matter what the feature rotation is.
      this.selector.scaling
        .copyFrom(boundingBox.maximumWorld)
        .subtractInPlace(boundingBox.minimumWorld)
        .addInPlace(new BABYLON.Vector3(OVERSIZE, OVERSIZE, OVERSIZE))
      // to account for this, when setting the selector rotation we subtract the feature's current rotation

      this.selection.parcel = boundingParcel

      // add parcel.boundingBox?.minimumWorld.y to bottomPivot to account for units in towers.
      const featureBottomToPivot = feature.positionInParcel.y - boundingBox!.minimumWorld.y + parcel.boundingBox?.minimumWorld.y
      spawnPoint.y += featureBottomToPivot
      selectorPoint.y += featureBottomToPivot

      spawnPoint.subtractInPlace(parcel.transform.position)
      selectorPoint.subtractInPlace(parcel.transform.position)
      // selector pivot is always in the middle- so we need to move the selector up by half feature height.
      const _featureHeight = featureHeight(feature)
      selectorPoint.y += _featureHeight / 2
      // Tells us if feature is on wall (or not if false), and also which wall (x or z)
      const onWall = normalIsFromWall(pickedNormal)
      const onCeiling = pickedNormal.y === -1

      if (onWall) {
        spawnPoint.y -= _featureHeight / 2
        selectorPoint.y -= _featureHeight / 2
      }

      // we are placing the feature on the ceiling
      if (onCeiling) {
        const translateDown = _featureHeight
        selectorPoint.y -= translateDown
        spawnPoint.y -= translateDown
      }
      // we are trying to place on a wall
      else if (featureIs3D(feature) && normalIsFromWall(pickedNormal)) {
        const boundingBox = feature.boundingBox
        if (!boundingBox) return false
        const size = boundingBox.maximumWorld.subtract(boundingBox.minimumWorld)
        const moveOutFromWall = pickedNormal.multiply(size).multiplyByFloats(0.5, 0.5, 0.5)
        spawnPoint.addInPlace(moveOutFromWall)
        selectorPoint.addInPlace(moveOutFromWall)
      }

      this.selector.position.copyFrom(selectorPoint)

      this.spawnPoint = spawnPoint
      this.selector.visibility = 1
      this.refreshBounds()

      return true
    } else if (this.selection.mode === 'add') {
      if (!pickedNormal || !this.selection.featureTemplate) {
        return false
      }
      this.selector.parent = parcel!.transform!

      const selectorPoint = pickedPointRounded.clone()
      const spawnPoint = pickedPointRounded.clone()
      // this.selection.feature is not null after COPY mode
      // Returns null or an array of the actual scale of the feature (boundingbox size * scale of the feature)
      const bb = this.selection.feature?.boundingBox || (this._prematureFeature as MeshedFeature | null)?.boundingBox || null
      const accurateScale = getAccurateScaleGivenBoundingBox(this.selection.featureTemplate, bb)
      const featureTemplateScale = this.selection.featureTemplate.scale
      const featureScale = () => (accurateScale ? accurateScale : featureTemplateScale)
      const isFeatureTemplate3D = getAxes(this.selection.featureTemplate.type).length == 1

      // fixme: particles and lantern have featureTemplate.rotation
      const rotation = getRotation(pickedPoint, pickedNormal, cameraPosition(this.scene))
      this.selector.rotation = rotation

      // the selector's pivot is in the middle- so we need to move it up so that its bottom is where our point is
      selectorPoint.y += featureScale()[1] / 2

      this.selector.scaling.set(featureScale()[0] + OVERSIZE, featureScale()[1] + OVERSIZE, featureScale()[2] + OVERSIZE)

      // account for features who's pivot is not at the bottom.
      spawnPoint.y += pivotToBottomOfBoundingBoxDefault(this.selection.featureTemplate.type, featureScale())
      spawnPoint.subtractInPlace(parcel.transform.position)
      selectorPoint.subtractInPlace(parcel.transform.position)
      if (bb) {
        spawnPoint.y -= bb.minimum.y * featureTemplateScale[1]
      }
      // Tells us if feature is on wall (or not if false), and also which wall (x or z)
      const onWall = normalIsFromWall(pickedNormal)
      const onCeiling = pickedNormal.y === -1
      // Placing on the wall? remove nudge of pivot point if yes.
      if (onWall) {
        spawnPoint.y -= featureScale()[1] / 2
        selectorPoint.y -= featureScale()[1] / 2
      }

      // we are trying to place on the ceiling
      if (onCeiling) {
        const translateDown = featureScale()[1]
        selectorPoint.y -= translateDown
        spawnPoint.y -= translateDown
      }
      // we are trying to place the feature on the wall
      else if (onWall) {
        // Only pivot to edge on the X axis if it's a 3d feature; else use the Z axis
        const featurePivotToBackEdge = onWall == 'x' && isFeatureTemplate3D ? featureScale()[0] / 2 : featureScale()[2] / 2
        const moveOutFromWall = pickedNormal.multiplyByFloats(featurePivotToBackEdge, featurePivotToBackEdge, featurePivotToBackEdge)
        spawnPoint.addInPlace(moveOutFromWall)
        selectorPoint.addInPlace(moveOutFromWall)
      }

      this.selector.position.copyFrom(selectorPoint)
      selectorPoint.y += parcel.transform.position.y
      this.spawnPoint = spawnPoint
      this.spawnRotation = rotation

      this.selector.visibility = 1

      this.refreshBounds()

      Object.assign(this.selection, { parcel })

      return true
    }
    return false
  }
}

const boundingBoxHeight = (boundingBox: BABYLON.BoundingBox): number => {
  return boundingBox.maximumWorld.y - boundingBox.minimumWorld.y
}

const featureHeight = (feature: MeshedFeature): number => {
  return feature.boundingBox ? boundingBoxHeight(feature.boundingBox) : 0
}

const roundVector3 = (vector: BABYLON.Vector3): BABYLON.Vector3 => {
  const roundingFunction = (value: any) => Math.round(value * 4) / 4
  vector.x = roundingFunction(vector.x)
  vector.y = roundingFunction(vector.y)
  vector.z = roundingFunction(vector.z)

  return vector
}

// to check if the normal belongs to a wall
export const normalIsFromWall = (normal: BABYLON.Vector3): 'z' | 'x' | false => {
  return !!Math.abs(normal.z) ? 'z' : !!Math.abs(normal.x) ? 'x' : false
}

// to check if the normal belongs to a ceiling or floor
const normalIsFromSurfaceWithHorizontalComponent = (normal: BABYLON.Vector3): boolean => {
  return !!Math.abs(normal.y)
}

// we use this to get the rotation of the feature and selector for when we are adding a new feature (floor and ceiling only)
// it makes the feature face the user
const getPseudoBillboardRotation = (pickedPoint: BABYLON.Vector3, cameraPosition: BABYLON.Vector3): BABYLON.Vector3 => {
  // the location is on the floor or the ceiling, align the vox model against the camera
  const a = new BABYLON.Vector2(pickedPoint.x, pickedPoint.z)
  const b = new BABYLON.Vector2(cameraPosition.x, cameraPosition.z)
  let yaw = Math.PI * 0.5 - BABYLON.Angle.BetweenTwoPoints(b, a).radians()
  const granularity = Math.PI / 2
  yaw = Math.round(yaw / granularity) * granularity
  return new BABYLON.Vector3(0, yaw, 0)
}

const getRotationForWallAlignment = (normal: BABYLON.Vector3): BABYLON.Vector3 => {
  // pick is on a wall surface, axis align with wall
  // from here www.babylonjs-playground.com/#25B8RK#13
  const axis2 = BABYLON.Vector3.Up()
  const axis3 = BABYLON.Vector3.Up()
  const start = new BABYLON.Vector3(Math.PI / 2, Math.PI / 2, 0)
  BABYLON.Vector3.CrossToRef(start, normal, axis2)
  BABYLON.Vector3.CrossToRef(axis2, normal, axis3)
  const v = BABYLON.Vector3.RotationFromAxis(axis3.negate(), normal, axis2)
  return new BABYLON.Vector3(0, v.y + Math.PI / 2, 0)
}

// determines spawn/selector rotation for when placing, moving, copying features.
const getRotation = (pickedPoint: BABYLON.Vector3, pickedNormal: BABYLON.Vector3, cameraPosition: BABYLON.Vector3): BABYLON.Vector3 => {
  if (normalIsFromSurfaceWithHorizontalComponent(pickedNormal)) {
    return getPseudoBillboardRotation(pickedPoint, cameraPosition)
  }

  // then normalIsFromWall
  return getRotationForWallAlignment(pickedNormal)
}
//Returns null or an array of the actual scale of the feature
const getAccurateScaleGivenBoundingBox = (featureTemplate: FeatureTemplate, BB: BABYLON.BoundingBox | null) => {
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
