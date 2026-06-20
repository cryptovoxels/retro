import { Component } from 'preact'
import { render, unmountComponentAtNode } from 'preact/compat'
import { isTablet } from '../../../common/helpers/detector'
import MobileControls from '../../controls/mobile/controls'

const SPEED = 0.15
const TAP_THRESHOLD = 8

export default class DpadControls extends Component<any, any> {
  static currentElement: HTMLElement
  padElement: HTMLDivElement = undefined!
  nubElement: HTMLDivElement = undefined!
  controls: MobileControls
  moved = false
  activeId: number | null = null

  constructor(props: any) {
    super()
    this.controls = props.controls
  }

  oncontextmenu = (e: Event) => {
    // KILL IT WITH FIRE!
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    return false
  }

  // follow the captured finger anywhere, clamped to the box so speed maxes at the edge
  private apply = (t: Touch) => {
    const rect = this.padElement.getBoundingClientRect()
    const half = rect.width / 2

    if (this.controls.congaTarget) this.controls.stopConga()

    let x = t.clientX - rect.left - half
    let y = t.clientY - rect.top - half
    x = Math.max(-half, Math.min(half, x))
    y = Math.max(-half, Math.min(half, y))

    if (Math.hypot(x, y) > TAP_THRESHOLD) this.moved = true

    this.controls.facingForward = y < 0
    this.controls.direction?.set((x / half) * SPEED, 0, (y / half) * -1 * SPEED)

    // nub is 33% of the box, so cap its visual offset to keep it inside the box (speed unchanged)
    const vis = half * 0.67
    const nx = Math.max(-vis, Math.min(vis, x))
    const ny = Math.max(-vis, Math.min(vis, y))
    this.nubElement && (this.nubElement.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`)
  }

  ontouchstart = (e: TouchEvent) => {
    if (this.activeId !== null) return // already walking with another finger
    const t = e.changedTouches[0]
    if (!t) return
    this.activeId = t.identifier
    this.moved = false
    this.apply(t)
    e.preventDefault()
  }

  ontouchmove = (e: TouchEvent) => {
    if (this.activeId === null) return
    const t = Array.from(e.touches).find((t) => t.identifier === this.activeId)
    if (!t) return
    this.apply(t)
    e.preventDefault()
  }

  ontouchend = (e: TouchEvent) => {
    if (this.activeId === null) return
    if (!Array.from(e.changedTouches).some((t) => t.identifier === this.activeId)) return

    this.activeId = null
    this.controls.direction?.set(0, 0, 0)
    this.nubElement && (this.nubElement.style.transform = 'translate(-50%, -50%)')

    // a touch that never dragged is a tap: jump
    if (!this.moved) (this.controls.camera as any)?.jump?.()
  }

  hide = () => {
    this.padElement.style.visibility = 'hidden'
  }

  show = () => {
    this.padElement.style.visibility = 'visible'
  }

  render() {
    return (
      <div>
        <div
          ref={(c) => {
            this.padElement = c!
          }}
          style={Object.assign({}, isTablet() ? { bottom: '250px' } : {})} // brings pad up on iPad
          className="mobile-pad"
          onContextMenu={this.oncontextmenu}
          onTouchStart={this.ontouchstart}
          onTouchMove={this.ontouchmove}
          onTouchEnd={this.ontouchend}
          onTouchCancel={this.ontouchend}
        >
          <div
            ref={(c) => {
              this.nubElement = c!
            }}
            className="mobile-pad-nub"
          />
        </div>
      </div>
    )
  }
}

export async function toggleDpadControls(controls: MobileControls) {
  if (DpadControls.currentElement) {
    unmountComponentAtNode(DpadControls.currentElement)
    DpadControls.currentElement = null!
    return null
  } else {
    const div = document.createElement('div')
    document.body.appendChild(div)
    DpadControls.currentElement = div

    return render(<DpadControls controls={controls} />, div) as DpadControls
  }
}
