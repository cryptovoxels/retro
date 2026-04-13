import { Component } from 'preact'
import { render, unmountComponentAtNode } from 'preact/compat'
import { isTablet } from '../../../common/helpers/detector'
import MobileControls from '../../controls/mobile/controls'

export default class DpadControls extends Component<any, any> {
  static currentElement: HTMLElement
  dpadElement: HTMLImageElement = undefined!
  controls: MobileControls

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

  ontouchstart = (e: TouchEvent) => {
    // this.ui.hideAll()
    const rect = this.dpadElement.getBoundingClientRect()

    // get the first touch that is over the dpad (in case the user is panning and walking at the same time)
    const touch = Array.from(e.touches).filter((touch: any) => {
      return touch.clientX < rect.right && touch.clientY > rect.top
    })[0] as any

    if (touch) {
      if (this.controls.congaTarget) this.controls.stopConga()
      const speed = 0.15
      const x = touch.clientX - rect.left - rect.width / 2
      const y = touch.clientY - rect.top - rect.height / 2
      this.controls.facingForward = y < 0
      this.controls.direction?.set((x / (rect.width / 2)) * speed, 0, (y / (rect.height / 2)) * -1 * speed)

      this.dpadElement && this.dpadElement.style.setProperty('opacity', '0.5')
    } else {
      this.controls.direction?.set(0, 0, 0)
    }
    e.preventDefault()
  }

  ontouchend = () => {
    this.controls.direction?.set(0, 0, 0)

    this.dpadElement && this.dpadElement.style.setProperty('opacity', '1')
  }

  hide = () => {
    this.dpadElement.style.visibility = 'hidden'
  }

  show = () => {
    this.dpadElement.style.visibility = 'visible'
  }

  render() {
    return (
      <div>
        <img
          ref={(c) => {
            this.dpadElement = c!
          }}
          style={Object.assign({}, isTablet() ? { bottom: '250px' } : {})} // brings dpad up on Ipad
          src="/images/dpad.png"
          draggable={false}
          className="mobile-dpad"
          onContextMenu={this.oncontextmenu}
          onTouchStart={this.ontouchstart}
          onTouchMove={this.ontouchstart}
          onTouchEnd={this.ontouchend}
          onTouchCancel={this.ontouchend}
        />
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
