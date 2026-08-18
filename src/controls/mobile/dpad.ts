import { isTablet } from '../../../common/helpers/detector'
import MobileControls from './controls'

const SPEED = 0.15
const TAP_THRESHOLD = 8
const DEPTH = 0.35
const PAD_FRAC = 0.4 // was 40vw
const REM = 16

function chatbarPx() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--chatbar').trim()
    if (raw.endsWith('rem')) return parseFloat(raw) * REM
    if (raw.endsWith('px')) return parseFloat(raw)
  } catch {}
  return 3 * REM
}

/** screen-space virtual stick drawn as camera-parented utility-layer planes */
export default class Dpad {
  private controls: MobileControls
  private canvas: HTMLCanvasElement
  private layer: BABYLON.UtilityLayerRenderer = undefined!
  private root: BABYLON.TransformNode = undefined!
  private pad: BABYLON.Mesh = undefined!
  private nub: BABYLON.Mesh = undefined!
  private worldSize = 0
  private rect = { left: 0, top: 0, size: 0 }
  private activeId: number | null = null
  private moved = false
  private visible = true
  private resizeObs: BABYLON.Observer<BABYLON.Engine> | null = null

  private onStart = (e: TouchEvent) => {
    if (!this.visible || this.activeId !== null) return
    const t = e.changedTouches[0]
    if (!t) return
    const p = this.canvasPoint(t)
    if (!this.inPad(p.x, p.y)) return
    this.activeId = t.identifier
    this.moved = false
    this.apply(p.x, p.y)
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private onMove = (e: TouchEvent) => {
    if (this.activeId === null) return
    const t = Array.from(e.touches).find((t) => t.identifier === this.activeId)
    if (!t) return
    const p = this.canvasPoint(t)
    this.apply(p.x, p.y)
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private onEnd = (e: TouchEvent) => {
    if (this.activeId === null) return
    if (!Array.from(e.changedTouches).some((t) => t.identifier === this.activeId)) return

    this.activeId = null
    this.controls.direction.set(0, 0, 0)
    this.nub.position.set(0, 0, 0.001)

    if (!this.moved) (this.controls.camera as any)?.jump?.()
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  constructor(controls: MobileControls, canvas: HTMLCanvasElement) {
    this.controls = controls
    this.canvas = canvas
  }

  mount() {
    const scene = this.controls.camera.getScene()
    this.layer = new BABYLON.UtilityLayerRenderer(scene)
    const util = this.layer.utilityLayerScene

    const padMat = new BABYLON.StandardMaterial('dpad-pad', util)
    padMat.diffuseColor.set(0.5, 0.5, 0.5)
    padMat.emissiveColor.set(0.5, 0.5, 0.5)
    padMat.specularColor.set(0, 0, 0)
    padMat.disableLighting = true
    padMat.alpha = 0.3
    padMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND
    padMat.disableDepthWrite = true
    padMat.freeze()

    const nubMat = new BABYLON.StandardMaterial('dpad-nub', util)
    nubMat.diffuseColor.set(0.5, 0.5, 0.5)
    nubMat.emissiveColor.set(0.5, 0.5, 0.5)
    nubMat.specularColor.set(0, 0, 0)
    nubMat.disableLighting = true
    nubMat.alpha = 0.6
    nubMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND
    nubMat.disableDepthWrite = true
    nubMat.freeze()

    this.root = new BABYLON.TransformNode('dpad', util)
    this.pad = BABYLON.MeshBuilder.CreatePlane('dpad-pad', { size: 1 }, util)
    this.pad.material = padMat
    this.pad.parent = this.root
    this.pad.isPickable = false

    this.nub = BABYLON.MeshBuilder.CreatePlane('dpad-nub', { size: 1 }, util)
    this.nub.material = nubMat
    this.nub.parent = this.root
    this.nub.isPickable = false
    this.nub.position.z = 0.001

    this.root.parent = this.controls.camera

    this.layout()
    const engine = scene.getEngine()
    this.resizeObs = engine.onResizeObservable.add(() => this.layout())

    const opts: AddEventListenerOptions = { capture: true, passive: false }
    this.canvas.addEventListener('touchstart', this.onStart, opts)
    this.canvas.addEventListener('touchmove', this.onMove, opts)
    this.canvas.addEventListener('touchend', this.onEnd, opts)
    this.canvas.addEventListener('touchcancel', this.onEnd, opts)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.root?.setEnabled(v)
    if (!v) {
      this.activeId = null
      this.controls.direction.set(0, 0, 0)
    }
  }

  dispose() {
    const opts: AddEventListenerOptions = { capture: true }
    this.canvas.removeEventListener('touchstart', this.onStart, opts)
    this.canvas.removeEventListener('touchmove', this.onMove, opts)
    this.canvas.removeEventListener('touchend', this.onEnd, opts)
    this.canvas.removeEventListener('touchcancel', this.onEnd, opts)

    if (this.resizeObs) {
      this.controls.camera.getScene().getEngine().onResizeObservable.remove(this.resizeObs)
      this.resizeObs = null
    }

    this.layer?.dispose()
  }

  private canvasPoint(t: Touch) {
    const r = this.canvas.getBoundingClientRect()
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }

  private inPad(x: number, y: number) {
    const { left, top, size } = this.rect
    return x >= left && x <= left + size && y >= top && y <= top + size
  }

  private layout() {
    const r = this.canvas.getBoundingClientRect()
    const w = r.width
    const h = r.height
    if (w <= 0 || h <= 0 || !this.controls.camera) return

    const size = w * PAD_FRAC
    const left = REM
    // iPad: lift off the home indicator / chat like the old inline style
    const bottom = isTablet() ? 250 : chatbarPx() + REM

    this.rect.left = left
    this.rect.top = h - bottom - size
    this.rect.size = size

    const cam = this.controls.camera
    const halfH = Math.tan(cam.fov / 2) * DEPTH
    const halfW = halfH * (w / h)

    const cx = left + size / 2
    const cy = this.rect.top + size / 2
    const x = (cx / w) * 2 * halfW - halfW
    const y = halfH - (cy / h) * 2 * halfH

    this.worldSize = (size / h) * 2 * halfH
    this.root.position.set(x, y, DEPTH)
    this.pad.scaling.setAll(this.worldSize)
    this.nub.scaling.setAll(this.worldSize * 0.33)
    this.nub.position.set(0, 0, 0.001)
  }

  private apply(px: number, py: number) {
    const half = this.rect.size / 2
    if (half <= 0) return

    if (this.controls.congaTarget) this.controls.stopConga()

    let x = px - this.rect.left - half
    let y = py - this.rect.top - half
    x = Math.max(-half, Math.min(half, x))
    y = Math.max(-half, Math.min(half, y))

    if (Math.hypot(x, y) > TAP_THRESHOLD) this.moved = true

    this.controls.direction.set((x / half) * SPEED, 0, (y / half) * -1 * SPEED)

    // nub is 33% of the box; cap visual offset so it stays inside
    const vis = half * 0.67
    const nx = Math.max(-vis, Math.min(vis, x))
    const ny = Math.max(-vis, Math.min(vis, y))
    const halfWorld = this.worldSize / 2
    this.nub.position.set((nx / half) * halfWorld, -(ny / half) * halfWorld, 0.001)
  }
}
