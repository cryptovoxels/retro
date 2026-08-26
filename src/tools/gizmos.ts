import { Vec3Description } from '../../common/messages/feature'
import Feature from '../features/feature'
import { setSelectedFeature } from '../store'
import { createEvent } from '../utils/EventEmitter'
import { limitAbsoluteValue, round } from '../utils/helpers'
import { isFlatWallFeature } from './flat-wall'
import { Mesh, SceneContext, StandardMaterialProps, TransformNode, Vec3, onBeforeRender } from '@babylonjs/lite'
import { mat4, vec3 } from 'wgpu-matrix'

let utilLayer = undefined as any | undefined
const gizmos: any[] = []
// This is to allow reverting the position if the new position set by gizmo is not allowed (outside hard limit)
let initialPosition: Vec3
let initialFeaturePosition: Vec3

// showboxes drag around like a window: grab the body, slide it in its own plane (depth locked). one shared behavior.
let windowDragMesh: Mesh | null = null
let windowDragMeshWasPickable = true
let windowDragFeatureStart: Vec3 | null = null
let windowDragMeshStart: Vec3 | null = null
let windowDragMeshWorldStart: Vec3 | null = null
let windowDragMoved = false
let windowDragActive = false
let windowDragCursorObserver: any | null = null
let windowDragPointerObserver: any | null = null
let windowDragPrePointerObserver: any | null = null
let windowDragUnfreezeObserver: any | null = null
let windowDragDocPointerUp: (() => void) | null = null
let windowDragFrame: PlaneFrame | null = null
let windowDragGrabU = 0
let windowDragGrabV = 0
// showbox corner-resize handles (custom; the native BoundingBoxGizmo floated off the parcel-parented mesh)
let activeHandles: ResizeHandleSet | null = null

type AxisLabel = 'X' | 'Y' | 'Z'

type PlaneFrame = { origin: Vec3; axisX: Vec3; axisY: Vec3; normal: Vec3 }

const planeFrameFromMesh = (mesh: Mesh): PlaneFrame => {
  const W = mesh.computeWorldMatrix(true)
  return {
    origin: mesh.getAbsolutePosition().clone(),
    axisX: (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.X, W).normalize() */),
    axisY: (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, W).normalize() */),
    normal: (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, W).normalize() */),
  }
}

/** After a real face-drag, ignore the trailing POINTERTAP so click-away does not clear selection. */
const updateHighlight = () => {
  window.ui?.featureTool?.updateHighlight()
}

/**
 * First we create the gizmos;
 * These will stay on standby until attached.
 */
export const createGizmos = (_scene: SceneContext) => {
  // todo(lite): AxisDragGizmo / UtilityLayerRenderer
  return gizmos
}

// create position gizmos
const createAxisDragGizmos = () => {
  const axes = [
    { color: (undefined as any /* todo(lite): BABYLON.Color3.FromHexString('#ff0000') */), label: 'X', axis: vec3.fromValues(1, 0, 0), alpha: 1 },
    { color: (undefined as any /* todo(lite): BABYLON.Color3.FromHexString('#00ff00') */), label: 'Y', axis: vec3.fromValues(0, 1, 0), alpha: 1 },
    { color: (undefined as any /* todo(lite): BABYLON.Color3.FromHexString('#0000ff') */), label: 'Z', axis: vec3.fromValues(0, 0, 1), alpha: 0.5 },
  ]

  return axes.map((a) => {
    const gizmo = (undefined as any /* todo(lite): new BABYLON.AxisDragGizmo(a.axis, a.color, utilLayer, undefined, 4) */)
    gizmo.snapDistance = 0.05
    gizmo.scaleRatio = 1.5
    gizmo.coloredMaterial.alpha = a.alpha
    gizmo.updateGizmoRotationToMatchAttachedMesh = false
    gizmo.isEnabled = false
    gizmo._rootMesh.metadata = { ...(gizmo._rootMesh.metadata || {}), axisLabel: a.label }
    addOnAxisDragBehavior(gizmo, a.label as AxisLabel)
    return gizmo
  })
}

const axisLabelOf = (gizmo: any): AxisLabel | undefined => gizmo._rootMesh?.metadata?.axisLabel

// position gizmos onDrag
const addOnAxisDragBehavior = (gizmo: any, axes: AxisLabel) => {
  gizmo.dragBehavior.onDragStartObservable.add(onAxisStartDrag(gizmo))
  gizmo.dragBehavior.onDragObservable.add(onDragObservableHandler(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(onAxisDragEnd(gizmo, axes))
  gizmo.dragBehavior.onDragStartObservable.add(GenericOnDragStart(gizmo))
  gizmo.dragBehavior.onDragEndObservable.add(GenericOnDragEnd(gizmo))
}

const gizmoTransform = (gizmo: any): TransformNode | null => (gizmo.attachedMesh as TransformNode | null) ?? (gizmo.attachedNode as TransformNode | null)

const onAxisStartDrag = (gizmo: any) => () => {
  const feature = getFeature(gizmo)
  const mesh = gizmoTransform(gizmo)
  if (!feature || !mesh) return
  initialPosition = mesh.position.clone()
  initialFeaturePosition = feature.position.clone()
}

const onAxisDragEnd = (gizmo: any, axis: AxisLabel) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  const mesh = gizmoTransform(gizmo)
  if (!mesh) return

  // flat wall features: local-depth Z; mesh.position can change on all axes when rotated - persist full delta
  if (isFlatWallFeature(feature)) {
    const position = initialFeaturePosition.clone().add(mesh.position.subtract(initialPosition))
    feature.set({ position: snapArray(position.asArray()) as Vec3Description })
  } else {
    const delta = mesh.position.clone().subtract(initialPosition)
    const position = feature.position.clone()
    if (axis === 'X') position.x += delta.x
    else if (axis === 'Y') position.y += delta.y
    else if (axis === 'Z') position.z += delta.z
    feature.set({ position: snapArray(position.asArray()) as Vec3Description })
  }

  feature.dispatchEvent(createEvent('dragged', true))

  onDragObservableHandler(gizmo)()
  setSelectedFeature(feature)
}

const onDragObservableHandler = (gizmo: any) => () => {
  const feature = getFeature(gizmo)
  if (!feature) return

  if (feature.type === 'group') {
    feature.refreshWorldMatrix()
  }

  updateHighlight()
}

const limitVector3AbsoluteValues = (vector3: Vec3, maximumAbsoluteValue: number): Vec3 => {
  vector3.x = limitAbsoluteValue(vector3.x, maximumAbsoluteValue)
  vector3.y = limitAbsoluteValue(vector3.y, maximumAbsoluteValue)
  vector3.z = limitAbsoluteValue(vector3.z, maximumAbsoluteValue)
  return vector3
}

const clearGizmo = (gizmo: any) => {
  gizmo.attachedMesh = null
  gizmo.attachedNode = null
  if ((false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */)) {
    gizmo.isEnabled = false
    gizmo.updateGizmoRotationToMatchAttachedMesh = false
  }
}

/**
 * Bind the gizmos to the feature
 * and adds the appropriate dragBehaviors
 */
export const bindGizmosToFeature = (feature: Feature) => {
  // always drop leftovers first — skipped X/Y axes used to stay enabled from the previous feature
  gizmos.forEach(clearGizmo)
  gizmos.forEach((gizmo: any) => {
    bindGizmoToFeature(gizmo, feature)
  })
  // flat wall features: face drag + corner resize + blue Z for depth (no X/Y arrows)
  if (isFlatWallFeature(feature)) {
    attachWindowDrag(feature)
    showResizeHandles(feature)
  } else {
    detachWindowDrag()
  }
}

const bindGizmoToFeature = (gizmo: any, feature: Feature) => {
  // flat wall: skip X/Y drag; keep Z for depth along the screen normal
  if (isFlatWallFeature(feature)) {
    if ((false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */) && axisLabelOf(gizmo) !== 'Z') {
      clearGizmo(gizmo)
      return
    }
  }

  if (feature.mesh) {
    if (feature.type === 'group' || feature.type === 'polytext' || feature.type === 'polytext-v2') {
      gizmo.attachedNode = feature.mesh
    } else {
      // all non-group features
      // typescript should know this is a Mesh here 😔
      gizmo.attachedMesh = feature.mesh as Mesh
    }
  }

  if ((false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */)) {
    gizmo.isEnabled = true
    // depth must follow the screen facing, not world Z (wall screens are rotated)
    if (isFlatWallFeature(feature) && (false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */)) {
      gizmo.updateGizmoRotationToMatchAttachedMesh = true
      gizmo.coloredMaterial.alpha = 1
      // small — Z points at the camera on wall art, so a fat arrow collider covers the face
      gizmo.scaleRatio = 0.75
    } else if ((false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */)) {
      gizmo.updateGizmoRotationToMatchAttachedMesh = false
      gizmo.scaleRatio = 1.5
      if (axisLabelOf(gizmo) === 'Z') gizmo.coloredMaterial.alpha = 0.5
    }
  }
}

export const unbindGizmosFromFeature = (feature: Feature) => {
  gizmos.forEach((gizmo) => {
    if (getFeature(gizmo)?.uuid !== feature.uuid) return
    clearGizmo(gizmo)
  })
  detachWindowDrag()
  hideResizeHandles(feature)
}

const getFeature = (gizmo: any): Feature | null => {
  const attachedEntity = gizmo.attachedMesh || (gizmo.attachedNode as any)
  if (!attachedEntity) return null
  return attachedEntity.feature as Feature // defined in feature.ts setCommon
}

export const rebindGizmos = (feature: Feature) => {
  gizmos.forEach((gizmo: any) => {
    const boundFeature = getFeature(gizmo)
    if (!boundFeature) return
    if (boundFeature.uuid === feature.uuid) {
      bindGizmoToFeature(gizmo, feature)
    }
  })
  // regenerate() swaps the mesh; re-point the window-drag onto the new one (handles read the mesh live, so they're fine).
  // uuid scope is load-bearing: every image still streaming into the parcel calls rebindGizmos on
  // mesh creation, and without it the first one after you open an editor stole the drag observers.
  if (isFlatWallFeature(feature) && windowDragMesh && (windowDragMesh as any).feature?.uuid === feature.uuid && windowDragMesh !== feature.mesh) {
    attachWindowDrag(feature)
  }
}

const roundNumberArray = (array: number[], dp: number) => array.map((i: number) => round(i, dp))

const SNAP = 0.05
const snapArray = (a: number[]) => a.map((v) => round(Math.round(v / SNAP) * SNAP, 2))

export const pointerOverGizmo = (scene: SceneContext): boolean => {
  if (utilLayer?.utilityLayerScene.pick(scene.pointerX, scene.pointerY)?.hit) return true
  if (windowDragMesh) {
    const p = scene.pick(scene.pointerX, scene.pointerY, (m) => m === windowDragMesh)
    if (p?.hit) return true
  }
  return false
}

/**
 * Generic observable on drag start;
 * @param gizmo The gizmo
 * @returns void
 */
const GenericOnDragStart = (gizmo: any) => () => {
  window.ui?.setDragging(true)
  const feature = getFeature(gizmo)
  if (!feature) return

  // If feature is animated, pause Animation on DragStart
  if (feature.isAnimated) {
    feature.pauseAnimation()
  }
}
const GenericOnDragEnd = (gizmo: any) => () => {
  window.ui?.setDragging(false)
  const feature = getFeature(gizmo)
  if (!feature) return

  // If feature is animated, pause Animation on DragStart
  if (feature.isAnimated) {
    feature.startAnimation((false /* todo(lite): gizmo instanceof BABYLON.AxisDragGizmo */) ? true : false)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Showbox window-drag (move): grab the body, slide it in its own plane (depth locked), like a window on a wall.
// Manual pointer drag (not PointerDragBehavior) — setCommon freezes the world matrix and Babylon's
// PointerDragBehavior silently stops moving a frozen mesh.
// ──────────────────────────────────────────────────────────────────────────

const rayHitPlane = (ray: any, origin: Vec3, normal: Vec3): Vec3 | null => {
  const denom = vec3.dot(ray.direction, normal)
  if (Math.abs(denom) < 1e-5) return null
  const t = vec3.dot(origin.subtract(ray.origin), normal) / denom
  if (t < 0) return null
  return ray.origin.add(ray.direction.scale(t))
}

const pointerRay = (scene: SceneContext): any | null => {
  const cam = scene.activeCamera
  if (!cam) return null
  return scene.createPickingRay(scene.pointerX, scene.pointerY, mat4.identity(), cam)
}

const setMeshWorldPositionOnPlane = (mesh: Mesh, worldPos: Vec3) => {
  mesh.unfreezeWorldMatrix()
  const parent = mesh.parent as TransformNode | null
  if (parent) {
    const inv = parent.getWorldMatrix().clone().invert()
    (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinatesToRef(worldPos, inv, mesh.position) */)
  } else {
    mesh.position.copyFrom(worldPos)
  }
  mesh.computeWorldMatrix(true)
}

const finishWindowDrag = (feature: Feature, mesh: Mesh, canvas: HTMLCanvasElement | null) => {
  windowDragFrame = null
  if (windowDragDocPointerUp) {
    document.removeEventListener('pointerup', windowDragDocPointerUp)
    windowDragDocPointerUp = null
  }
  if (utilLayer) utilLayer.pickingEnabled = true
  const wasDrag = windowDragActive && windowDragMoved
  windowDragActive = false
  if (!wasDrag) {
    windowDragFeatureStart = windowDragMeshStart = windowDragMeshWorldStart = null
    windowDragMoved = false
    return
  }
  window.ui?.setDragging(false)
  if (canvas) canvas.style.cursor = ''
  if (windowDragFeatureStart && windowDragMeshStart) {
    const position = windowDragFeatureStart.add(mesh.position.subtract(windowDragMeshStart))
    feature.set({ position: snapArray(position.asArray()) as Vec3Description })
    feature.dispatchEvent(createEvent('dragged', true))
    setSelectedFeature(feature)
  }
  windowDragFeatureStart = windowDragMeshStart = windowDragMeshWorldStart = null
  windowDragMoved = false
  updateHighlight()
}

const attachWindowDrag = (feature: Feature) => {
  const mesh = feature.mesh as Mesh | undefined
  if (!mesh) return
  detachWindowDrag()

  const scene = mesh.getScene()
  const canvas = scene.getEngine().getRenderingCanvas()

  mesh.unfreezeWorldMatrix()
  windowDragMeshWasPickable = mesh.isPickable
  mesh.isPickable = true
  mesh.enablePointerMoveEvents = true
  ;(mesh as any).hoverCursor = 'move'
  scene.constantlyUpdateMeshUnderPointer = true

  // setCommon freezes meshes; keep this one thawed the whole time the editor gizmos are bound
  windowDragUnfreezeObserver = onBeforeRender(scene, () => {
    if (windowDragMesh && windowDragMesh.isWorldMatrixFrozen) windowDragMesh.unfreezeWorldMatrix()
  })

  windowDragCursorObserver = scene.onPointerObservable.add((info) => {
    if (info.type !== (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERMOVE */) || !canvas || !windowDragMesh) return
    if (windowDragActive || window.ui?.state?.dragging) {
      canvas.style.cursor = 'move'
      return
    }
    const cur = canvas.style.cursor
    if (cur === 'nwse-resize' || cur === 'nesw-resize') return
    if (scene.meshUnderPointer === windowDragMesh || info.pickInfo?.pickedMesh === windowDragMesh) {
      canvas.style.cursor = 'move'
    } else if (cur === 'move') {
      canvas.style.cursor = ''
    }
  })

  // Drag START runs on the PRE-pointer observable: the utility layer swallows any POINTERDOWN
  // its scene picks (skipOnPointerObservable) — and the Z arrow points at the camera on wall art,
  // so its collider covers the face center and face drag looked randomly dead. Face wins on the
  // face; corner handles still win; the Z arrow stays grabbable where it sticks past the face.
  windowDragPrePointerObserver = scene.onPrePointerObservable.add(
    (info) => {
      if (!windowDragMesh || windowDragMesh !== mesh) return
      if (info.type !== (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERDOWN */) || info.event.button !== 0) return

      if (utilLayer) {
        const uPick = utilLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY)
        if (uPick?.hit && uPick.pickedMesh?.name?.startsWith('feature/showbox/resize-handle/')) return
      }
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m === mesh)
      if (!pick?.hit) return

      mesh.unfreezeWorldMatrix()
      const frame = planeFrameFromMesh(mesh)
      const ray = pointerRay(scene)
      if (!ray) return
      const hit = rayHitPlane(ray, frame.origin, frame.normal)
      if (!hit) return

      windowDragFrame = frame
      windowDragGrabU = vec3.dot(hit.subtract(frame.origin), frame.axisX)
      windowDragGrabV = vec3.dot(hit.subtract(frame.origin), frame.axisY)
      windowDragFeatureStart = feature.position.clone()
      windowDragMeshStart = mesh.position.clone()
      windowDragMeshWorldStart = mesh.getAbsolutePosition().clone()
      windowDragMoved = false
      windowDragActive = true
      windowDragDocPointerUp = onDocPointerUp
      document.addEventListener('pointerup', onDocPointerUp)
      if (utilLayer) {
        // gizmo layer swallows MOVEs its scene picks — the Z collider covers the face center,
        // so a center grab froze mid-drag. It has no business picking while we own the gesture.
        utilLayer.pickingEnabled = false
      }
      // we own the gesture: gizmo layer and desktop clicks both skip this down
      info.skipOnPointerObservable = true
    },
    undefined,
    true,
  )

  // MOVE only. The claimed DOWN never captured the pointer, so Babylon drops the matching UP/TAP
  // on scene observables — the document pointerup below is the one true terminator.
  windowDragPointerObserver = scene.onPointerObservable.add(
    (info) => {
      if (!windowDragMesh || windowDragMesh !== mesh) return
      if (!windowDragActive) return
      if (info.type !== (undefined as any /* todo(lite): BABYLON.PointerEventTypes.POINTERMOVE */)) return

      const frame = windowDragFrame
      const worldStart = windowDragMeshWorldStart
      if (!frame || !worldStart) return
      mesh.unfreezeWorldMatrix()
      const ray = pointerRay(scene)
      if (!ray) return
      const hit = rayHitPlane(ray, frame.origin, frame.normal)
      if (!hit) return

      const u = vec3.dot(hit.subtract(frame.origin), frame.axisX)
      const v = vec3.dot(hit.subtract(frame.origin), frame.axisY)
      const du = u - windowDragGrabU
      const dv = v - windowDragGrabV
      if (!windowDragMoved && (Math.abs(du) > 0.002 || Math.abs(dv) > 0.002)) {
        windowDragMoved = true
        window.ui?.setDragging(true)
      }
      if (windowDragMoved) {
        const worldPos = worldStart.add(frame.axisX.scale(du)).add(frame.axisY.scale(dv))
        setMeshWorldPositionOnPlane(mesh, worldPos)
        if (canvas) canvas.style.cursor = 'move'
        updateHighlight()
      }
    },
    undefined,
    true,
  )

  const onDocPointerUp = () => {
    // mesh guard: a stale listener from an interrupted drag must never finish another feature's drag
    if (!windowDragActive || windowDragMesh !== mesh) return
    finishWindowDrag(feature, mesh, canvas)
  }

  windowDragMesh = mesh
}

const detachWindowDrag = () => {
  windowDragFrame = null
  windowDragActive = false
  if (windowDragDocPointerUp) {
    document.removeEventListener('pointerup', windowDragDocPointerUp)
    windowDragDocPointerUp = null
  }
  if (utilLayer) utilLayer.pickingEnabled = true
  if (windowDragMesh) {
    const scene = windowDragMesh.getScene()
    if (windowDragCursorObserver) {
      scene.onPointerObservable.remove(windowDragCursorObserver)
      windowDragCursorObserver = null
    }
    if (windowDragPointerObserver) {
      scene.onPointerObservable.remove(windowDragPointerObserver)
      windowDragPointerObserver = null
    }
    if (windowDragPrePointerObserver) {
      scene.onPrePointerObservable.remove(windowDragPrePointerObserver)
      windowDragPrePointerObserver = null
    }
    if (windowDragUnfreezeObserver) {
      scene.onBeforeRenderObservable.remove(windowDragUnfreezeObserver)
      windowDragUnfreezeObserver = null
    }
    ;(windowDragMesh as any).hoverCursor = ''
    windowDragMesh.isPickable = windowDragMeshWasPickable
    scene.constantlyUpdateMeshUnderPointer = false // else the whole app picks every pointer move forever
    const canvas = scene.getEngine().getRenderingCanvas()
    if (canvas && canvas.style.cursor === 'move') canvas.style.cursor = ''
  }
  windowDragMesh = null
  windowDragFeatureStart = windowDragMeshStart = windowDragMeshWorldStart = null
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
const resizeCursorForCorner = (corner: { sx: number; sy: number }, mesh: Mesh, scene: SceneContext) => {
  const cam = scene.activeCamera
  if (!cam) return 'nwse-resize'
  const W = mesh.computeWorldMatrix(true)
  const cWorld = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(corner.sx * 0.5, corner.sy * 0.5, 0), W) */)
  const aWorld = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(-corner.sx * 0.5, -corner.sy * 0.5, 0), W) */)
  const engine = scene.getEngine()
  const viewport = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const transform = scene.getTransformMatrix()
  const cScr = (undefined as any /* todo(lite): BABYLON.Vector3.Project(cWorld, BABYLON.Matrix.Identity(), transform, viewport) */)
  const aScr = (undefined as any /* todo(lite): BABYLON.Vector3.Project(aWorld, BABYLON.Matrix.Identity(), transform, viewport) */)
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
  private scene: SceneContext
  private uScene: SceneContext
  private canvas: HTMLCanvasElement | null
  private handles: Mesh[] = []
  private normals: Vec3[] = [] // per-handle live drag-plane normal (updated each frame)
  private observer: any | null = null
  private material: StandardMaterialProps

  constructor(feature: Feature, layer: any) {
    this.feature = feature
    this.scene = layer.originalScene
    this.uScene = layer.utilityLayerScene
    this.canvas = this.scene.getEngine().getRenderingCanvas()

    this.material = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('feature/showbox/resize-handle/mat', this.uScene) */)
    this.material.emissiveColor = (undefined as any /* todo(lite): BABYLON.Color3.FromHexString('#e6635a') */)
    this.material.disableLighting = true

    HANDLE_CORNERS.forEach((corner, i) => {
      const handle = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateBox(`feature/showbox/resize-handle/${i}`, { size: 1 }, this.uScene) */)
      handle.material = this.material
      handle.isPickable = true
      handle.enablePointerMoveEvents = true
      handle.billboardMode = (undefined as any /* todo(lite): BABYLON.Mesh.BILLBOARDMODE_ALL */) // easy to grab from any angle
      this.normals.push((undefined as any /* todo(lite): BABYLON.Axis.Z.clone() */))
      this.handles.push(handle)
      this.attachHoverCursor(handle, corner)
      this.attachDrag(handle, corner, i)
    })

    // place + size the handles every frame from the showbox's own world matrix
    this.observer = onBeforeRender(this.scene, () => this.sync())
    this.sync()
  }

  private sync() {
    const mesh = this.feature.mesh
    if (!mesh) return
    const W = mesh.computeWorldMatrix(true)
    const camPos = this.scene.activeCamera?.globalPosition ?? vec3.create()
    const normal = (undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, W).normalize() */) // screen forward in world

    this.handles.forEach((handle, i) => {
      const c = HANDLE_CORNERS[i]
      const worldCorner = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(c.sx * 0.5, c.sy * 0.5, 0), W) */)
      handle.position.copyFrom(worldCorner)
      // constant on-screen size: scale by distance to camera, independent of the screen's own scale
      handle.scaling.setAll(HANDLE_PIXEL_SIZE * vec3.distance(worldCorner, camPos))
      this.normals[i].copyFrom(normal)
    })
  }

  private attachHoverCursor(handle: Mesh, corner: { sx: number; sy: number }) {
    handle.actionManager = (undefined as any /* todo(lite): new BABYLON.ActionManager(this.uScene) */)
    handle.actionManager.registerAction(
      (undefined as any /* todo(lite): new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, () => {
        const mesh = this.feature.mesh
        if (!this.canvas || !mesh) return
        this.canvas.style.cursor = resizeCursorForCorner(corner, mesh as BABYLON.Mesh, this.scene)
      }) */),
    )
    handle.actionManager.registerAction(
      (undefined as any /* todo(lite): new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOutTrigger, () => {
        if (this.canvas) this.canvas.style.cursor = ''
      }) */),
    )
  }

  private attachDrag(handle: Mesh, corner: { sx: number; sy: number }, index: number) {
    const behavior = (undefined as any /* todo(lite): new BABYLON.PointerDragBehavior() */)
    behavior.moveAttached = false // we own handle placement via sync()
    behavior.useObjectOrientationForDragging = false

    const anchorWorld = vec3.create() // opposite corner, pinned for the whole drag
    const axisX = vec3.create() // screen local-X direction in world (normalized)
    const axisY = vec3.create()
    const anchorLocal = vec3.fromValues(-corner.sx * 0.5, -corner.sy * 0.5, 0)
    let startW = 1 // scale at drag start, so we can keep the screen's aspect ratio
    let startH = 1
    // drag-start snapshots for the commit. mesh transform = feature values + setCommon's z-nudge
    // and nudgeGrowth, so committing the raw mesh values baked the nudge in and the image jumped
    // (and grew) on every release. Commit feature values + drag delta instead, like face drag does.
    const featurePosStart = vec3.create()
    const meshPosStart = vec3.create()
    const featureScaleStart = vec3.create()
    const meshScaleStart = vec3.create()

    behavior.onDragStartObservable.add(() => {
      const mesh = this.feature.mesh
      if (!mesh) return
      if (this.canvas) this.canvas.style.cursor = resizeCursorForCorner(corner, mesh as Mesh, this.scene)
      window.ui?.setDragging(true)
      if (this.feature.isAnimated) this.feature.pauseAnimation()
      mesh.unfreezeWorldMatrix() // we mutate scaling/position during the drag
      startW = Math.abs(mesh.scaling.x) || 1
      startH = Math.abs(mesh.scaling.y) || 1
      featurePosStart.copyFrom(this.feature.position)
      meshPosStart.copyFrom(mesh.position)
      featureScaleStart.copyFrom(this.feature.scale)
      meshScaleStart.copyFrom(mesh.scaling)
      const W = mesh.computeWorldMatrix(true)
      axisX.copyFrom((undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.X, W).normalize() */))
      axisY.copyFrom((undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, W).normalize() */))
      anchorWorld.copyFrom((undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(anchorLocal, W) */))
    })

    behavior.onDragObservable.add((event) => {
      const mesh = this.feature.mesh
      if (!mesh) return
      behavior.options.dragPlaneNormal = this.normals[index] // keep the drag plane on the screen plane

      // vector from the pinned opposite corner to the pointer, decomposed onto the screen axes.
      // plane geometry is 1 unit wide, so world width == scaling.x (likewise y).
      const D = event.dragPlanePoint.subtract(anchorWorld)
      const rawW = corner.sx * vec3.dot(D, axisX)
      const rawH = corner.sy * vec3.dot(D, axisY)
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
      const newAnchorWorld = (undefined as any /* todo(lite): BABYLON.Vector3.TransformCoordinates(anchorLocal, W2) */)
      const shiftWorld = anchorWorld.subtract(newAnchorWorld)
      const parent = mesh.parent as TransformNode | null
      if (parent) {
        const inv = parent.getWorldMatrix().clone().invert()
        mesh.position.addInPlace((undefined as any /* todo(lite): BABYLON.Vector3.TransformNormal(shiftWorld, inv) */))
      } else {
        mesh.position.addInPlace(shiftWorld)
      }
      mesh.computeWorldMatrix(true)
      updateHighlight()
    })

    behavior.onDragEndObservable.add(() => {
      if (this.canvas) this.canvas.style.cursor = ''
      const feature = this.feature
      const mesh = feature.mesh
      if (!mesh) {
        window.ui?.setDragging(false)
        return
      }
      // commit BEFORE clearing dragging — setDragging(false) rerenders the editor and merge
      // must see the post-drag description (and the dragging guard must still be up during set)
      // 2dp matches the Position/Scale field truncate — 4dp remounts those fields and they
      // write the truncated value back ~100ms later (second tiny settle after release)
      const scale = limitVector3AbsoluteValues(featureScaleStart.add(mesh.scaling.subtract(meshScaleStart)), 50)
      const position = featurePosStart.add(mesh.position.subtract(meshPosStart))
      feature.set({
        scale: snapArray(scale.asArray()) as Vec3Description,
        position: snapArray(position.asArray()) as Vec3Description,
      })
      feature.refreshWorldMatrix()
      if (feature.isAnimated) feature.startAnimation(false)
      setSelectedFeature(feature) // preact rerender of the editor number fields
      updateHighlight()
      window.ui?.setDragging(false)
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
