import { Vec3Description } from '../../common/messages/feature'
import type Feature from '../features/feature'
import { freezeFeature, thawFeature } from '../utils'
import { setSelectedFeature } from '../store'
import { createEvent } from '../utils/EventEmitter'
import { round } from '../utils/helpers'
import { isFlatWallFeature } from './flat-wall'
import TransformOverlay from './transform-overlay'
import Transform from './transform'

let activeFeature: Feature | null = null
let overlay: TransformOverlay | null = null
let transform: Transform | null = null
let wall: WallDrag | null = null
const SNAP = 0.05

export const hasGizmos = (feature: Feature) => activeFeature === feature && feature.mesh instanceof BABYLON.AbstractMesh
const updateHighlight = () => window.ui?.featureTool?.updateHighlight()

export const createGizmos = (scene: BABYLON.Scene) => {
  scene.onBeforeRenderObservable.add(() => {
    const mesh = activeFeature?.mesh
    overlay?.sync(mesh instanceof BABYLON.AbstractMesh ? mesh : null, true, wall?.corner ?? -1)
  })
  scene.onDisposeObservable.addOnce(() => {
    if (activeFeature) unbindGizmosFromFeature(activeFeature)
  })
}

export const bindGizmosToFeature = (feature: Feature) => {
  if (activeFeature) unbindGizmosFromFeature(activeFeature)
  feature.renderEditing = true
  thawFeature(feature)
  activeFeature = feature
  if (!feature.mesh) return
  if (isFlatWallFeature(feature)) {
    overlay = new TransformOverlay(feature.mesh.getScene(), true)
    wall = new WallDrag(feature)
  } else {
    transform = new Transform(feature.mesh.getScene())
    transform.gizmos.gizmos.positionGizmo!.snapDistance = SNAP
    transform.gizmos.gizmos.positionGizmo!.updateGizmoRotationToMatchAttachedMesh = false
    let meshStart = feature.mesh.position.clone()
    let featureStart = feature.position.clone()
    transform.onStart = () => {
      meshStart.copyFrom(feature.mesh!.position)
      featureStart.copyFrom(feature.position)
      window.ui?.setDragging(true)
      if (feature.isAnimated) feature.pauseAnimation()
    }
    transform.onEnd = (commit) => {
      try {
        if (commit && feature.mesh) {
          const position = featureStart.add(feature.mesh.position.subtract(meshStart))
          feature.set({ position: position.asArray().map((n) => round(n, 4)) as Vec3Description })
          feature.dispatchEvent(createEvent('dragged', true))
          setSelectedFeature(feature)
        }
      } finally {
        if (feature.isAnimated) feature.startAnimation(false)
        window.ui?.setDragging(false)
      }
    }
    transform.attach(feature.mesh)
  }
  updateHighlight()
}

export const unbindGizmosFromFeature = (feature: Feature) => {
  if (activeFeature === feature) {
    wall?.dispose()
    wall = null
    overlay?.dispose()
    overlay = null
    transform?.dispose()
    transform = null
    activeFeature = null
  }
  feature.renderEditing = false
  freezeFeature(feature)
}

export const rebindGizmos = (feature: Feature) => {
  if (activeFeature !== feature) return
  if (!transform && !overlay && feature.mesh) bindGizmosToFeature(feature)
  else transform?.attach(feature.mesh ?? null)
}

export const pointerOverGizmo = (_scene: BABYLON.Scene): boolean => !!(transform?.over() || wall?.hit())

// One captured gesture for face movement and corner resizing. Camera and scene
// picking never receive a claimed gesture, so utility-layer observer order is irrelevant.
class WallDrag {
  corner = -1
  private scene: BABYLON.Scene
  private canvas: HTMLCanvasElement
  private drag: {
    pointer: number
    mesh: BABYLON.Mesh
    position: BABYLON.Vector3
    scale: BABYLON.Vector3
    featurePosition: BABYLON.Vector3
    featureScale: BABYLON.Vector3
    origin: BABYLON.Vector3
    normal: BABYLON.Vector3
    grab: BABYLON.Vector3
    axisX: BABYLON.Vector3
    axisY: BABYLON.Vector3
    width: number
    height: number
    anchor: BABYLON.Vector3
    localAnchor: BABYLON.Vector3
    inverse: BABYLON.Matrix
    moved: boolean
  } | null = null

  constructor(private feature: Feature) {
    this.scene = feature.mesh!.getScene()
    this.canvas = this.scene.getEngine().getRenderingCanvas()!
    this.canvas.addEventListener('pointerdown', this.down, true)
    for (const handle of overlay!.handles) handle.addEventListener('pointerdown', this.down)
    document.addEventListener('pointermove', this.move, true)
    document.addEventListener('pointerup', this.up, true)
    document.addEventListener('pointercancel', this.cancel, true)
    document.addEventListener('keydown', this.key, true)
    window.addEventListener('blur', this.cancel)
    this.canvas.addEventListener('lostpointercapture', this.cancel)
  }

  hit() {
    return this.scene.pick(this.scene.pointerX, this.scene.pointerY)?.pickedMesh === this.feature.mesh
  }

  private ray(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect()
    return this.scene.createPickingRay(event.clientX - rect.left, event.clientY - rect.top, BABYLON.Matrix.Identity(), this.scene.activeCamera)
  }

  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.drag || document.pointerLockElement) return
    const mesh = this.feature.mesh
    if (!(mesh instanceof BABYLON.Mesh)) return
    const corner = overlay!.handles.indexOf(event.currentTarget as HTMLButtonElement)
    const ray = this.ray(event)
    if (corner < 0 && this.scene.pickWithRay(ray)?.pickedMesh !== mesh) return
    thawFeature(this.feature)
    const world = mesh.computeWorldMatrix(true)
    const origin = mesh.getAbsolutePosition().clone()
    const axisX = BABYLON.Vector3.TransformNormal(BABYLON.Axis.X, world)
    const axisY = BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, world)
    const normal = BABYLON.Vector3.Cross(axisX, axisY).normalize()
    const distance = ray.intersectsPlane(BABYLON.Plane.FromPositionAndNormal(origin, normal))
    if (distance === null || distance < 0) return
    const bounds = mesh.getBoundingInfo().boundingBox
    if (!axisX.lengthSquared() || !axisY.lengthSquared() || bounds.minimum.x === bounds.maximum.x || bounds.minimum.y === bounds.maximum.y) return
    const localAnchor = new BABYLON.Vector3(corner & 1 ? bounds.minimum.x : bounds.maximum.x, corner & 2 ? bounds.minimum.y : bounds.maximum.y, 0)
    this.corner = corner
    this.drag = {
      pointer: event.pointerId,
      mesh,
      position: mesh.position.clone(),
      scale: mesh.scaling.clone(),
      featurePosition: this.feature.position.clone(),
      featureScale: this.feature.scale.clone(),
      origin,
      normal,
      grab: ray.origin.add(ray.direction.scale(distance)),
      width: axisX.length() * (bounds.maximum.x - bounds.minimum.x),
      height: axisY.length() * (bounds.maximum.y - bounds.minimum.y),
      axisX: axisX.normalize(),
      axisY: axisY.normalize(),
      localAnchor,
      anchor: BABYLON.Vector3.TransformCoordinates(localAnchor, world),
      inverse: mesh.parent ? (mesh.parent as BABYLON.TransformNode).computeWorldMatrix(true).clone().invert() : BABYLON.Matrix.Identity(),
      moved: false,
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    this.canvas.setPointerCapture(event.pointerId)
    window.ui?.setDragging(true)
    if (this.feature.isAnimated) this.feature.pauseAnimation()
  }

  private move = (event: PointerEvent) => {
    const d = this.drag
    if (!d || event.pointerId !== d.pointer) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (this.feature.mesh !== d.mesh) return this.finish(false)
    const ray = this.ray(event)
    const distance = ray.intersectsPlane(BABYLON.Plane.FromPositionAndNormal(d.origin, d.normal))
    if (distance === null || distance < 0) return
    const delta = ray.origin.add(ray.direction.scale(distance)).subtract(d.grab)
    if (delta.lengthSquared() < 0.000004 && !d.moved) return
    d.moved = true
    const mesh = d.mesh
    mesh.position.copyFrom(d.position)
    mesh.scaling.copyFrom(d.scale)
    const snap = (value: number) => (event.altKey ? value : Math.round(value / SNAP) * SNAP)
    if (this.corner < 0) {
      const shift = d.axisX.scale(snap(BABYLON.Vector3.Dot(delta, d.axisX))).add(d.axisY.scale(snap(BABYLON.Vector3.Dot(delta, d.axisY))))
      mesh.position.addInPlace(BABYLON.Vector3.TransformNormal(shift, d.inverse))
    } else {
      const sx = this.corner & 1 ? 1 : -1
      const sy = this.corner & 2 ? 1 : -1
      let x = d.featureScale.x + snap(((sx * BABYLON.Vector3.Dot(delta, d.axisX)) / d.width) * d.scale.x)
      let y = d.featureScale.y + snap(((sy * BABYLON.Vector3.Dot(delta, d.axisY)) / d.height) * d.scale.y)
      if (this.feature.scaleAspectLocked !== false) {
        const k = Math.abs(x / d.featureScale.x - 1) > Math.abs(y / d.featureScale.y - 1) ? x / d.featureScale.x : y / d.featureScale.y
        const factor = Math.max(Math.max(0.05 / d.featureScale.x, 0.05 / d.featureScale.y), Math.min(k, 50 / d.featureScale.x, 50 / d.featureScale.y))
        x = d.featureScale.x * factor
        y = d.featureScale.y * factor
      }
      mesh.scaling.x += Math.max(0.05, Math.min(50, x)) - d.featureScale.x
      mesh.scaling.y += Math.max(0.05, Math.min(50, y)) - d.featureScale.y
      const anchor = BABYLON.Vector3.TransformCoordinates(d.localAnchor, mesh.computeWorldMatrix(true))
      mesh.position.addInPlace(BABYLON.Vector3.TransformNormal(d.anchor.subtract(anchor), d.inverse))
    }
    mesh.computeWorldMatrix(true)
  }

  private finish(commit: boolean) {
    const d = this.drag
    if (!d) return
    this.drag = null
    this.corner = -1
    try {
      if (commit && d.moved && this.feature.mesh === d.mesh) {
        const values = (v: BABYLON.Vector3) => v.asArray().map((n) => round(n, 4)) as Vec3Description
        this.feature.set({
          position: values(d.featurePosition.add(d.mesh.position.subtract(d.position))),
          scale: values(d.featureScale.add(d.mesh.scaling.subtract(d.scale))),
        })
        this.feature.dispatchEvent(createEvent('dragged', true))
        setSelectedFeature(this.feature)
      } else {
        d.mesh.position.copyFrom(d.position)
        d.mesh.scaling.copyFrom(d.scale)
        d.mesh.computeWorldMatrix(true)
      }
    } finally {
      if (this.canvas.hasPointerCapture(d.pointer)) this.canvas.releasePointerCapture(d.pointer)
      if (this.feature.isAnimated) this.feature.startAnimation(false)
      window.ui?.setDragging(false)
      updateHighlight()
    }
  }

  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.drag?.pointer) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.finish(true)
  }
  private cancel = () => this.finish(false)
  private key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.drag) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.finish(false)
  }

  dispose() {
    this.finish(false)
    this.canvas.removeEventListener('pointerdown', this.down, true)
    for (const handle of overlay?.handles ?? []) handle.removeEventListener('pointerdown', this.down)
    document.removeEventListener('pointermove', this.move, true)
    document.removeEventListener('pointerup', this.up, true)
    document.removeEventListener('pointercancel', this.cancel, true)
    document.removeEventListener('keydown', this.key, true)
    window.removeEventListener('blur', this.cancel)
    this.canvas.removeEventListener('lostpointercapture', this.cancel)
  }
}
