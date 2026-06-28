import { Vec3Description } from '../../common/messages/feature'
import Feature from '../features/feature'
import Group from '../features/group'
import { IYoutubePlayer } from '../features/youtube'
import { setSelectedFeature } from '../store'
import { createEvent } from '../utils/EventEmitter'
import { axisNames3D, limitAbsoluteValue, round, XYZ } from '../utils/helpers'

let utilLayer = undefined as BABYLON.UtilityLayerRenderer | undefined
const gizmos: (BABYLON.AxisDragGizmo | BABYLON.RotationGizmo | BABYLON.AxisScaleGizmo)[] = []
// This is to allow reverting the position if the new position set by gizmo is not allowed (outside hard limit)
let initialPosition: BABYLON.Vector3

type AxisLabel = 'X' | 'Y' | 'Z'

const updateHighlight = () => {
  process.nextTick(() => {
    window.ui?.featureTool?.updateHighlight()
  })
}

/**
 * First we create the gizmos;
 * These will stay on standby until attached.
 */
export const createGizmos = (scene: BABYLON.Scene) => {
  utilLayer = utilLayer || new BABYLON.UtilityLayerRenderer(scene)

  gizmos.push(...createAxisDragGizmos())
  // gizmos.push(...createAxisScaleGizmos())
  // gizmos.push(createRotationGizmo())

  return gizmos
}

// create position gizmos
const createAxisDragGizmos = () => {
  const axes = [
    { color: BABYLON.Color3.FromHexString('#ff0000'), label: 'X', axis: BABYLON.Axis.X, alpha: 1 },
    { color: BABYLON.Color3.FromHexString('#00ff00'), label: 'Y', axis: BABYLON.Axis.Y, alpha: 1 },
    { color: BABYLON.Color3.FromHexString('#0000ff'), label: 'Z', axis: BABYLON.Axis.Z, alpha: 0.5 },
  ]

  return axes.map((a) => {
    const gizmo = new BABYLON.AxisDragGizmo(a.axis, a.color, utilLayer, undefined, 4)
    gizmo.snapDistance = 0.01
    gizmo.scaleRatio = 1.5
    // gizmo.customRotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, 0, 0)
    // gizmo.coordinatesMode = BABYLON.GizmoCoordinatesMode.World
    // gizmo.anchorPoint = BABYLON.GizmoAnchorPoint.Pivot
    gizmo.coloredMaterial.alpha = a.alpha
    gizmo.updateGizmoRotationToMatchAttachedMesh = false
    gizmo.isEnabled = false
    addOnAxisDragBehavior(gizmo, a.label as AxisLabel)
    return gizmo
  })
}

// position gizmos onDrag
const addOnAxisDragBehavior = (gizmo: BABYLON.AxisDragGizmo, axes: AxisLabel) => {
  gizmo.dragBehavior.onDragStartObservable.add(onAxisStartDrag(gizmo))
  gizmo.dragBehavior.onDragObservable.add(onDragObservableHandler(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(onAxisDragEnd(gizmo, axes))
  // gizmo.dragBehavior.onDragStartObservable.add(onAxisStartDrag(gizmo))
  // Generic observables
  gizmo.dragBehavior.onDragStartObservable.add(GenericOnDragStart(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(GenericOnDragEnd(gizmo))
}

const onAxisStartDrag = (gizmo: BABYLON.Gizmo) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return
  initialPosition = gizmo.attachedMesh!.position.clone()
}

const onAxisDragEnd = (gizmo: BABYLON.AxisDragGizmo, axis: AxisLabel) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  const delta = gizmo.attachedMesh!.position.clone().subtract(initialPosition)
  const position = feature.position.clone()

  if (axis === 'X') {
    position.x += delta.x
    console.log('x drag', delta.x)
  } else if (axis === 'Y') {
    position.y += delta.y
    console.log('y drag', delta.y)
  } else if (axis === 'Z') {
    position.z += delta.z
    console.log('z drag', delta.z)
  }

  feature.set({ position: roundNumberArray(position.asArray(), 4) as Vec3Description })
  // feature.dispatchEvent('dragged')
  feature.dispatchEvent(createEvent('dragged', true))

  onDragObservableHandler(gizmo)()
  setSelectedFeature(feature)
}

const onDragObservableHandler = (gizmo: BABYLON.IGizmo) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  if (feature.type === 'group') {
    feature.refreshWorldMatrix()
  }

  if (feature.type === 'youtube') {
    const f = feature as Feature & { player: IYoutubePlayer | null } //youtube player
    if (f.player) {
      if (gizmo instanceof BABYLON.AxisDragGizmo || gizmo instanceof BABYLON.AxisScaleGizmo) {
        f.player.refreshPosition()
      } else {
        f.player.refreshRotation()
      }
    }
  }

  updateHighlight()
}

// create scale gizmos
const createAxisScaleGizmos = () => {
  return [BABYLON.Axis.X, BABYLON.Axis.Y, BABYLON.Axis.Z].map((axis) => {
    const gizmo = new BABYLON.AxisScaleGizmo(axis, BABYLON.Color3.FromHexString('#e6635a'), utilLayer, undefined, 1)
    gizmo.isEnabled = false
    gizmo.scaleRatio = 1.6

    // save which axis the gizmo is working on
    // we'll need this when locking aspect ratio
    const axisName = axisNames3D.find((axisName: XYZ) => {
      return axis[axisName]
    })
    gizmo._rootMesh.metadata = { axisName }

    addOnAxisScaleBehavior(gizmo)
    return gizmo
  })
}
// scale gizmos onDrag
const addOnAxisScaleBehavior = (gizmo: BABYLON.AxisScaleGizmo) => {
  gizmo.dragBehavior.onDragObservable.add(onAxisScaleDrag(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(onAxisScaleDragEnd(gizmo))

  // Generic observables
  gizmo.dragBehavior.onDragStartObservable.add(GenericOnDragStart(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(GenericOnDragEnd(gizmo))
}

const onAxisScaleDrag = (gizmo: BABYLON.AxisScaleGizmo) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  if (feature.type === 'group') {
    enforceLockedAspectRatio(feature as Group, gizmo._rootMesh.metadata.axisName)
  }
  onDragObservableHandler(gizmo)()
}

const enforceLockedAspectRatio = (group: Group, draggedAxisName: XYZ) => {
  if (!group.mesh) throw new Error('Group has no mesh')

  const newScaleVale = group.mesh.scaling[draggedAxisName]
  for (const axisName of group.scaleAxes()) {
    if (axisName === draggedAxisName) continue
    group.mesh.scaling[axisName] = newScaleVale
  }
}

const onAxisScaleDragEnd = (gizmo: BABYLON.AxisScaleGizmo) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  onAxisScaleDrag(gizmo) // ensure that aspect ratio is 1 before we preserve state

  setScale(feature)
  // trigger preact rerender
  setSelectedFeature(feature)
}

const setScale = (feature: Feature) => {
  if (!feature.mesh) {
    return
  }
  let scale = feature.mesh.scaling
  scale = limitVector3AbsoluteValues(scale.clone(), 50)
  feature.set({ scale: roundNumberArray(scale.asArray(), 4) as Vec3Description })
}

const limitVector3AbsoluteValues = (vector3: BABYLON.Vector3, maximumAbsoluteValue: number): BABYLON.Vector3 => {
  vector3.x = limitAbsoluteValue(vector3.x, maximumAbsoluteValue)
  vector3.y = limitAbsoluteValue(vector3.y, maximumAbsoluteValue)
  vector3.z = limitAbsoluteValue(vector3.z, maximumAbsoluteValue)
  return vector3
}

const createRotationGizmo = () => {
  const rotationGizmo = new BABYLON.RotationGizmo(utilLayer, undefined, undefined, 2)
  const ringsScaling = new BABYLON.Vector3(0.6, 0.6, 0.6)
  rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false

  const gizmos = [rotationGizmo.xGizmo, rotationGizmo.yGizmo, rotationGizmo.zGizmo]
  gizmos.forEach((gizmo) => {
    gizmo.dragBehavior.onDragObservable.add(onDragObservableHandler(gizmo))
    // @ts-expect-error hackery poking at the internals of gizmo
    gizmo._gizmoMesh.scaling = ringsScaling.clone() // make rotation gizmo appear larger than is standard
  })

  rotationGizmo.onDragEndObservable.add(onRotationDragStart(rotationGizmo))
  rotationGizmo.onDragEndObservable.add(onRotationDragEnd(rotationGizmo))
  return rotationGizmo
}

const onRotationDragStart = (gizmo: BABYLON.RotationGizmo) => () => {
  const feature = getFeature(gizmo)
  if (feature?.mesh) {
    // if the scaling is non-uniform, there is no mathematical way babylonjs can rotate the gizmo to align to the mesh,
    // so in that case we align the rotation gizmo with the world axis.
    gizmo.updateGizmoRotationToMatchAttachedMesh = Math.abs(feature.scale.x - feature.scale.y) <= BABYLON.Epsilon && Math.abs(feature.scale.x - feature.scale.z) <= BABYLON.Epsilon
  }

  GenericOnDragStart(gizmo)
}

const onRotationDragEnd = (gizmo: BABYLON.RotationGizmo) => () => {
  const feature = getFeature(gizmo)
  if (!feature?.mesh) return

  feature.set({ rotation: roundNumberArray(feature.mesh.rotation.asArray(), 4) as Vec3Description })
  // trigger preact rerender

  setSelectedFeature(feature)
  GenericOnDragEnd(gizmo)
}

/**
 * Bind the gizmos to the feature
 * and adds the appropriate dragBehaviors
 */
export const bindGizmosToFeature = (feature: Feature) => {
  gizmos.forEach((gizmo: BABYLON.Gizmo) => {
    bindGizmoToFeature(gizmo, feature)
  })
}

const bindGizmoToFeature = (gizmo: BABYLON.Gizmo, feature: Feature) => {
  // No need to show the z-axis of the scale gizmo for images and 2d features
  if (feature.scaleAxes.length == 2 && gizmo instanceof BABYLON.AxisScaleGizmo && gizmo._rootMesh.metadata?.axis == BABYLON.Axis.Z) {
    return
  }

  if (feature.mesh) {
    if (feature.type === 'group' || feature.type === 'polytext' || feature.type === 'polytext-v2') {
      gizmo.attachedNode = feature.mesh
    } else {
      // all non-group features
      // typescript should know this is a Mesh here 😔
      gizmo.attachedMesh = feature.mesh as BABYLON.Mesh
    }
  }

  if (gizmo instanceof BABYLON.AxisDragGizmo || gizmo instanceof BABYLON.AxisScaleGizmo) {
    gizmo.isEnabled = true
  }
}

export const unbindGizmosFromFeature = (feature: Feature) => {
  gizmos.forEach((gizmo) => {
    if (getFeature(gizmo)?.uuid !== feature.uuid) return

    gizmo.attachedMesh = null
    gizmo.attachedNode = null

    if (gizmo instanceof BABYLON.AxisDragGizmo) {
      gizmo.isEnabled = false
    }
  })
}

const getFeature = (gizmo: BABYLON.IGizmo): Feature | null => {
  const attachedEntity = gizmo.attachedMesh || (gizmo.attachedNode as any)
  if (!attachedEntity) return null
  return attachedEntity.feature as Feature // defined in feature.ts setCommon
}

export const rebindGizmosBoundToFeature = (feature: Feature) => {
  gizmos.forEach((gizmo: BABYLON.Gizmo) => {
    const boundFeature = getFeature(gizmo)
    if (!boundFeature) return
    if (boundFeature.uuid === feature.uuid) {
      bindGizmoToFeature(gizmo, feature)
    }
  })
}

const roundNumberArray = (array: number[], dp: number) => array.map((i: number) => round(i, dp))

/**
 * Generic observable on drag start;
 * @param gizmo The gizmo
 * @returns void
 */
const GenericOnDragStart = (gizmo: BABYLON.Gizmo) => () => {
  window.ui?.setDragging(true)
  const feature = getFeature(gizmo)
  if (!feature) return

  // If feature is animated, pause Animation on DragStart
  if (feature.isAnimated) {
    feature.pauseAnimation()
  }
}
const GenericOnDragEnd = (gizmo: BABYLON.Gizmo) => () => {
  window.ui?.setDragging(false)
  const feature = getFeature(gizmo)
  if (!feature) return

  // If feature is animated, pause Animation on DragStart
  if (feature.isAnimated) {
    feature.startAnimation(gizmo instanceof BABYLON.AxisDragGizmo ? true : false)
  }
}
