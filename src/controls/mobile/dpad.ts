import MobileControls from './controls'

const TAP_THRESHOLD = 8

/** Left-half drags walk; right-half pointers reach the camera. */
export default class Dpad {
  private controls: MobileControls
  private canvas: HTMLCanvasElement
  private originX = 0
  private originY = 0
  private activeId: number | null = null
  private moved = false
  private visible = true

  // babylon's camera input listens for pointer events on the canvas; these run first
  // (document, capture) and swallow left-half drags so walking never turns
  // the camera. other pointers pass through untouched.
  private onPointerDown = (e: PointerEvent) => {
    if (!this.visible || this.activeId !== null || e.target !== this.canvas) return
    const p = this.canvasPoint(e)
    if (!this.inPad(p.x, p.y)) return
    this.activeId = e.pointerId
    this.moved = false
    this.originX = p.x
    this.originY = p.y
    this.apply(p.x, p.y)
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return
    const p = this.canvasPoint(e)
    this.apply(p.x, p.y)
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private onPointerEnd = (e: PointerEvent) => {
    if (e.pointerId !== this.activeId) return

    this.activeId = null
    this.controls.direction.set(0, 0, 0)

    if (!this.moved && e.type === 'pointerup') this.controls.body.jump()
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  // `* { touch-action: manipulation }` lets the page pan; block that for pad touches
  private onTouch = (e: TouchEvent) => {
    if (!this.visible) return
    if (this.activeId !== null) {
      e.preventDefault()
      return
    }
    const t = e.changedTouches[0]
    if (t && this.inPad(...this.canvasXY(t.clientX, t.clientY))) e.preventDefault()
  }

  constructor(controls: MobileControls, canvas: HTMLCanvasElement) {
    this.controls = controls
    this.canvas = canvas
  }

  mount() {
    this.controls.camera.getScene().onDisposeObservable.addOnce(() => this.dispose())
    const opts: AddEventListenerOptions = { capture: true, passive: false }
    document.addEventListener('pointerdown', this.onPointerDown, opts)
    document.addEventListener('pointermove', this.onPointerMove, opts)
    document.addEventListener('pointerup', this.onPointerEnd, opts)
    document.addEventListener('pointercancel', this.onPointerEnd, opts)
    this.canvas.addEventListener('touchstart', this.onTouch, opts)
    this.canvas.addEventListener('touchmove', this.onTouch, opts)
  }

  setVisible(v: boolean) {
    this.visible = v
    if (!v) {
      this.activeId = null
      this.controls.direction.set(0, 0, 0)
    }
  }

  dispose() {
    const opts: AddEventListenerOptions = { capture: true }
    document.removeEventListener('pointerdown', this.onPointerDown, opts)
    document.removeEventListener('pointermove', this.onPointerMove, opts)
    document.removeEventListener('pointerup', this.onPointerEnd, opts)
    document.removeEventListener('pointercancel', this.onPointerEnd, opts)
    this.canvas.removeEventListener('touchstart', this.onTouch, opts)
    this.canvas.removeEventListener('touchmove', this.onTouch, opts)

    this.controls.direction.setAll(0)
  }

  private canvasXY(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [clientX - r.left, clientY - r.top]
  }

  private canvasPoint(e: { clientX: number; clientY: number }) {
    const [x, y] = this.canvasXY(e.clientX, e.clientY)
    return { x, y }
  }

  private inPad(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect()
    return x >= 0 && x < r.width / 2 && y >= 0 && y <= r.height
  }

  private apply(px: number, py: number) {
    const half = this.canvas.clientWidth * 0.2
    if (half <= 0) return

    if (this.controls.congaTarget) this.controls.stopConga()

    let x = px - this.originX
    let y = py - this.originY
    x = Math.max(-half, Math.min(half, x))
    y = Math.max(-half, Math.min(half, y))

    if (Math.hypot(x, y) > TAP_THRESHOLD) this.moved = true

    this.controls.direction.set(x / half, 0, (y / half) * -1)
  }
}
