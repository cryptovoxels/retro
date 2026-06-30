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

// showboxes drag around like a window: grab the body, slide it in its own plane (depth locked). one shared behavior.
let windowDrag: BABYLON.PointerDragBehavior | null = null
let windowDragMesh: BABYLON.Mesh | null = null
let windowDragFeatureStart: BABYLON.Vector3 | null = null
let windowDragMeshStart: BABYLON.Vector3 | null = null
let windowDragMoved = false
// showbox corner-resize handles (custom; the native BoundingBoxGizmo floated off the parcel-parented mesh)
let activeHandles: ResizeHandleSet | null = null

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
  // gizmos.push(...createAxisScaleGizmos()) // showboxes now resize via custom corner handles; nothing else uses scale arrows
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
  // showboxes move by dragging the body like a window, and resize from corner handles - no arrows
  if (feature.type === 'showbox') {
    attachWindowDrag(feature)
    showResizeHandles(feature)
  } else {
    detachWindowDrag()
  }
}

const bindGizmoToFeature = (gizmo: BABYLON.Gizmo, feature: Feature) => {
  // showboxes use a body-drag (move) + custom corner handles (resize), so no arrow gizmos for them
  if (feature.type === 'showbox' && (gizmo instanceof BABYLON.AxisDragGizmo || gizmo instanceof BABYLON.AxisScaleGizmo)) return

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

    if (gizmo instanceof BABYLON.AxisDragGizmo || gizmo instanceof BABYLON.AxisScaleGizmo) {
      gizmo.isEnabled = false
    }
  })
  detachWindowDrag()
  hideResizeHandles(feature)
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
  // regenerate() swaps the mesh; re-point the window-drag onto the new one (handles read the mesh live, so they're fine)
  if (feature.type === 'showbox' && windowDragMesh && windowDragMesh !== feature.mesh) {
    attachWindowDrag(feature)
  }
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

// ──────────────────────────────────────────────────────────────────────────
// Showbox window-drag (move): grab the body, slide it in its own plane (depth locked), like a window on a wall.
// ──────────────────────────────────────────────────────────────────────────

const attachWindowDrag = (feature: Feature) => {
  const mesh = feature.mesh as BABYLON.Mesh | undefined
  if (!mesh) return
  detachWindowDrag()

  // drag plane normal = the screen's local Z; useObjectOrientationForDragging makes that normal follow the
  // screen's facing, so the body slides on the wall it faces instead of a world-aligned plane.
  const behavior = new BABYLON.PointerDragBehavior({ dragPlaneNormal: BABYLON.Axis.Z })
  behavior.useObjectOrientationForDragging = true

  behavior.onDragStartObservable.add(() => {
    windowDragFeatureStart = feature.position.clone()
    windowDragMeshStart = mesh.position.clone()
    windowDragMoved = false // a plain click fires start+end with no move - don't treat it as a drag
  })
  behavior.onDragObservable.add(() => {
    if (!windowDragMoved) {
      windowDragMoved = true
      window.ui?.setDragging(true) // only once a real drag has begun, so a click doesn't flicker the editor
    }
  })
  behavior.onDragEndObservable.add(() => {
    if (!windowDragMoved) return // plain click: never moved -> don't persist, don't touch UI
    window.ui?.setDragging(false)
    if (windowDragFeatureStart && windowDragMeshStart) {
      // persist feature.position + the mesh delta, mirroring onAxisDragEnd (mesh space can differ under a group)
      const position = windowDragFeatureStart.add(mesh.position.subtract(windowDragMeshStart))
      feature.set({ position: roundNumberArray(position.asArray(), 4) as Vec3Description })
      feature.dispatchEvent(createEvent('dragged', true))
      setSelectedFeature(feature)
    }
    windowDragFeatureStart = windowDragMeshStart = null
    windowDragMoved = false
  })

  mesh.addBehavior(behavior)
  windowDrag = behavior
  windowDragMesh = mesh
}

const detachWindowDrag = () => {
  if (windowDrag && windowDragMesh) windowDragMesh.removeBehavior(windowDrag)
  windowDrag = null
  windowDragMesh = null
  windowDragFeatureStart = windowDragMeshStart = null
  windowDragMoved = false
}

// ──────────────────────────────────────────────────────────────────────────
// Showbox corner-resize handles (custom). The native BoundingBoxGizmo floated because it could not
// reconstruct the showbox transform (parcel-transform parent offset + Euler rotation + post-scale nudge +
// frozen matrix). These handles are placed every frame straight from the mesh world matrix, so they always
// sit on the real visible corners.
// ──────────────────────────────────────────────────────────────────────────

const HANDLE_PIXEL_SIZE = 0.018 // handle size as a fraction of distance-to-camera (~constant on-screen size)
const HANDLE_MIN_SCALE = 0.05 // clamp so the screen can't collapse / invert
const HANDLE_MAX_SCALE = 50 // matches setScale()'s cap

// the 4 plane corners in local space (CreatePlane({ size: 1 }) spans -0.5..0.5)
const HANDLE_CORNERS = [
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
  { sx: -1, sy: -1 },
  { sx: 1, sy: -1 },
]

// diagonal resize cursor that matches the handle corner in screen space (screens rotate on walls)
const resizeCursorForCorner = (corner: { sx: number; sy: number }, mesh: BABYLON.Mesh, scene: BABYLON.Scene) => {
  const cam = scene.activeCamera
  if (!cam) return 'nwse-resize'
  const W = mesh.computeWorldMatrix(true)
  const cWorld = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(corner.sx * 0.5, corner.sy * 0.5, 0), W)
  const aWorld = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-corner.sx * 0.5, -corner.sy * 0.5, 0), W)
  const engine = scene.getEngine()
  const viewport = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const transform = scene.getTransformMatrix()
  const cScr = BABYLON.Vector3.Project(cWorld, BABYLON.Matrix.Identity(), transform, viewport)
  const aScr = BABYLON.Vector3.Project(aWorld, BABYLON.Matrix.Identity(), transform, viewport)
  const dx = cScr.x - aScr.x
  const dy = cScr.y - aScr.y
  return dx * dy > 0 ? 'nwse-resize' : 'nesw-resize'
}

const showResizeHandles = (feature: Feature) => {
  hideResizeHandles()
  if (!utilLayer || !feature.mesh) return
  activeHandles = new ResizeHandleSet(feature, utilLayer)
}

const hideResizeHandles = (feature?: Feature) => {
  if (!activeHandles) return
  if (feature && activeHandles.feature.uuid !== feature.uuid) return
  activeHandles.dispose()
  activeHandles = null
}

class ResizeHandleSet {
  feature: Feature
  private scene: BABYLON.Scene
  private uScene: BABYLON.Scene
  private canvas: HTMLCanvasElement | null
  private handles: BABYLON.Mesh[] = []
  private normals: BABYLON.Vector3[] = [] // per-handle live drag-plane normal (updated each frame)
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null
  private material: BABYLON.StandardMaterial

  constructor(feature: Feature, layer: BABYLON.UtilityLayerRenderer) {
    this.feature = feature
    this.scene = layer.originalScene
    this.uScene = layer.utilityLayerScene
    this.canvas = this.scene.getEngine().getRenderingCanvas()

    this.material = new BABYLON.StandardMaterial('feature/showbox/resize-handle/mat', this.uScene)
    this.material.emissiveColor = BABYLON.Color3.FromHexString('#e6635a')
    this.material.disableLighting = true

    HANDLE_CORNERS.forEach((corner, i) => {
      const handle = BABYLON.MeshBuilder.CreateBox(`feature/showbox/resize-handle/${i}`, { size: 1 }, this.uScene)
      handle.material = this.material
      handle.isPickable = true
      handle.enablePointerMoveEvents = true
      handle.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL // easy to grab from any angle
      this.normals.push(BABYLON.Axis.Z.clone())
      this.handles.push(handle)
      this.attachHoverCursor(handle, corner)
      this.attachDrag(handle, corner, i)
    })

    // place + size the handles every frame from the showbox's own world matrix
    this.observer = this.scene.onBeforeRenderObservable.add(() => this.sync())
    this.sync()
  }

  private sync() {
    const mesh = this.feature.mesh
    if (!mesh) return
    const W = mesh.computeWorldMatrix(true)
    const camPos = this.scene.activeCamera?.globalPosition ?? BABYLON.Vector3.Zero()
    const normal = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, W).normalize() // screen forward in world

    this.handles.forEach((handle, i) => {
      const c = HANDLE_CORNERS[i]
      const worldCorner = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(c.sx * 0.5, c.sy * 0.5, 0), W)
      handle.position.copyFrom(worldCorner)
      // constant on-screen size: scale by distance to camera, independent of the screen's own scale
      handle.scaling.setAll(HANDLE_PIXEL_SIZE * BABYLON.Vector3.Distance(worldCorner, camPos))
      this.normals[i].copyFrom(normal)
    })
  }

  private attachHoverCursor(handle: BABYLON.Mesh, corner: { sx: number; sy: number }) {
    handle.actionManager = new BABYLON.ActionManager(this.uScene)
    handle.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        const mesh = this.feature.mesh
        if (!this.canvas || !mesh) return
        this.canvas.style.cursor = resizeCursorForCorner(corner, mesh as BABYLON.Mesh, this.scene)
      }),
    )
    handle.actionManager.registerAction(
      new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        if (this.canvas) this.canvas.style.cursor = ''
      }),
    )
  }

  private attachDrag(handle: BABYLON.Mesh, corner: { sx: number; sy: number }, index: number) {
    const behavior = new BABYLON.PointerDragBehavior()
    behavior.moveAttached = false // we own handle placement via sync()
    behavior.useObjectOrientationForDragging = false

    const anchorWorld = new BABYLON.Vector3() // opposite corner, pinned for the whole drag
    const axisX = new BABYLON.Vector3() // screen local-X direction in world (normalized)
    const axisY = new BABYLON.Vector3()
    const anchorLocal = new BABYLON.Vector3(-corner.sx * 0.5, -corner.sy * 0.5, 0)
    let startW = 1 // scale at drag start, so we can keep the screen's aspect ratio
    let startH = 1

    behavior.onDragStartObservable.add(() => {
      const mesh = this.feature.mesh
      if (!mesh) return
      if (this.canvas) this.canvas.style.cursor = resizeCursorForCorner(corner, mesh as BABYLON.Mesh, this.scene)
      window.ui?.setDragging(true)
      if (this.feature.isAnimated) this.feature.pauseAnimation()
      mesh.unfreezeWorldMatrix() // we mutate scaling/position during the drag
      startW = Math.abs(mesh.scaling.x) || 1
      startH = Math.abs(mesh.scaling.y) || 1
      const W = mesh.computeWorldMatrix(true)
      axisX.copyFrom(BABYLON.Vector3.TransformNormal(BABYLON.Axis.X, W).normalize())
      axisY.copyFrom(BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, W).normalize())
      anchorWorld.copyFrom(BABYLON.Vector3.TransformCoordinates(anchorLocal, W))
    })

    behavior.onDragObservable.add((event) => {
      const mesh = this.feature.mesh
      if (!mesh) return
      behavior.options.dragPlaneNormal = this.normals[index] // keep the drag plane on the screen plane

      // vector from the pinned opposite corner to the pointer, decomposed onto the screen axes.
      // plane geometry is 1 unit wide, so world width == scaling.x (likewise y).
      const D = event.dragPlanePoint.subtract(anchorWorld)
      const rawW = corner.sx * BABYLON.Vector3.Dot(D, axisX)
      const rawH = corner.sy * BABYLON.Vector3.Dot(D, axisY)
      let width: number
      let height: number
      if (this.feature.scaleAspectLocked !== false) {
        // aspect-ratio lock on (default for screens): one uniform factor, so it scales properly and never distorts
        const k = Math.max(rawW / startW, rawH / startH, HANDLE_MIN_SCALE)
        width = startW * k
        height = startH * k
      } else {
        // lock off: each axis follows its own edge (free stretch)
        width = Math.max(Math.abs(rawW), HANDLE_MIN_SCALE)
        height = Math.max(Math.abs(rawH), HANDLE_MIN_SCALE)
      }
      width = limitAbsoluteValue(width, HANDLE_MAX_SCALE)
      height = limitAbsoluteValue(height, HANDLE_MAX_SCALE)

      mesh.scaling.x = width
      mesh.scaling.y = height

      // pivot is the plane centre, so scaling moved BOTH corners - shift the mesh so the opposite
      // corner returns to where it started (true grab-the-corner behaviour).
      const W2 = mesh.computeWorldMatrix(true)
      const newAnchorWorld = BABYLON.Vector3.TransformCoordinates(anchorLocal, W2)
      const shiftWorld = anchorWorld.subtract(newAnchorWorld)
      const parent = mesh.parent as BABYLON.TransformNode | null
      if (parent) {
        const inv = parent.getWorldMatrix().clone().invert()
        mesh.position.addInPlace(BABYLON.Vector3.TransformNormal(shiftWorld, inv))
      } else {
        mesh.position.addInPlace(shiftWorld)
      }
      mesh.computeWorldMatrix(true)
      updateHighlight()
    })

    behavior.onDragEndObservable.add(() => {
      window.ui?.setDragging(false)
      if (this.canvas) this.canvas.style.cursor = ''
      const feature = this.feature
      if (!feature.mesh) return
      setScale(feature) // persists clamped/rounded scale (existing helper)
      feature.set({ position: roundNumberArray(feature.mesh.position.asArray(), 4) as Vec3Description })
      feature.refreshWorldMatrix()
      if (feature.isAnimated) feature.startAnimation(false)
      setSelectedFeature(feature) // preact rerender of the editor number fields
    })

    handle.addBehavior(behavior)
  }

  dispose() {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer)
      this.observer = null
    }
    if (this.canvas) this.canvas.style.cursor = ''
    this.handles.forEach((h) => h.dispose())
    this.handles = []
    this.material.dispose()
  }
}
