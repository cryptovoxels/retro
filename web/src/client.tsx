import { Component, createRef } from 'preact'
import { route } from 'preact-router'
import { canUseDom } from '../../common/helpers/utils'
import { getCoords, notifyUrlChange, syncParcelUrl } from './helpers/coords-nav'
import type { BootResult } from '../../src'

function boot(): Promise<BootResult> {
  return import(/* webpackMode: "eager" */ '../../src').then((m) => m.bootEngine())
}

type Mode = 'full' | 'embed'

type FrameProps = {
  coords: string
  mode: Mode
}

type FrameState = { ui?: BootResult }

export class Client extends Component<FrameProps, FrameState> {
  root = createRef<HTMLDivElement>()
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null
  watch: ReturnType<typeof setInterval> | null = null
  fit: (() => void) | null = null

  componentDidMount() {
    if (!canUseDom) {
      return
    }
    // editor/sidebar CSS is gated on this; set it as soon as the world client mounts,
    // not only after canvas adopt (which can early-return and leave the class off)
    document.body.classList.add('in-world')
    void boot().then((ui) => {
      this.setState({ ui })
      this.adopt()
    })
  }

  componentDidUpdate(previousProps: Readonly<FrameProps>): void {
    if (previousProps.coords !== this.props.coords && this.props.coords) {
      this.naviport()
    }
    if (this.props.mode === 'embed' || previousProps.mode !== this.props.mode) {
      this.track()
    }
  }

  componentWillUnmount() {
    this.untrack()
    if (this.watch) clearInterval(this.watch)
    this.watch = null

    const canvas = document.getElementById('renderCanvas')
    if (canvas && this.box.current?.contains(canvas)) {
      canvas.style.display = 'none'
      document.body.appendChild(canvas)
    }

    document.body.classList.remove('in-world')
  }

  private adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) {
      return
    }

    box.appendChild(canvas)
    canvas.style.display = 'block'
    document.body.classList.add('in-world')
    this.syncCoordsUrl()
    this.track()
    // .client-world may land in the same frame as mount; re-fit once the push slot exists
    requestAnimationFrame(() => this.track())
    this.naviport()

    if (this.watch) clearInterval(this.watch)
    this.watch = setInterval(() => {
      if (!getCoords()) return
      const m = location.pathname.match(/^\/parcels\/(\d+)$/)
      if (!m) return
      const id = window.grid?.currentParcel()?.id
      if (id && id !== parseInt(m[1], 10)) syncParcelUrl(id)
    }, 200)
  }

  private untrack() {
    this.observer?.disconnect()
    this.observer = null
    if (this.fit) {
      window.removeEventListener('scroll', this.fit, true)
      this.fit = null
    }
  }

  private track() {
    this.untrack()

    const root = this.root.current
    if (!root) return

    // full: .client-world; embed: .client-slot; else #mini-client in the nav
    const preferred = this.props.mode === 'full' ? '.client-world' : '.client-slot'

    const slot = (document.querySelector(preferred) as HTMLElement | null) || (document.querySelector('#mini-client') as HTMLElement | null)

    if (!slot) {
      if (this.props.mode === 'full') {
        root.style.position = 'fixed'
        root.style.top = '0'
        root.style.left = '0'
        root.style.right = '0'
        root.style.bottom = '0'
        root.style.width = ''
        root.style.height = ''
        window.engine?.resize()
      }
      return
    }

    const fit = () => {
      const r = slot.getBoundingClientRect()
      // fixed + viewport rect so the canvas tracks the push-panel slot as the sidebar opens/closes
      root.style.position = 'fixed'
      root.style.top = `${r.top}px`
      root.style.left = `${r.left}px`
      root.style.width = `${Math.max(0, r.width)}px`
      root.style.height = `${Math.max(0, r.height)}px`
      root.style.right = 'auto'
      root.style.bottom = 'auto'

      if (slot.id.match(/mini/)) {
        root.classList.add('mini')
      } else {
        root.classList.remove('mini')
      }

      window.engine?.resize()
    }

    this.fit = fit
    fit()
    this.observer = new ResizeObserver(fit)
    this.observer.observe(slot)
    window.addEventListener('scroll', fit, true)
  }

  private syncCoordsUrl() {
    const c = this.props.coords
    if (!c || getCoords()) {
      return
    }
    const u = new URL(location.href)
    u.searchParams.set('coords', c)
    route(u.pathname + u.search, true)
    notifyUrlChange()
  }

  private naviport() {
    const coords = this.props.coords
    if (!coords) {
      return
    }
    void boot().then(() => {
      try {
        window.persona?.naviport(coords)
      } catch (e) {
        console.error('[great-merge] naviport failed', e)
      }
    })
  }

  render() {
    const ui = this.state.ui
    return (
      <div class={`client -${this.props.mode}`} ref={this.root}>
        <div class="client-canvas" ref={this.box} />
        {ui && <ui.UI {...ui.props} />}
      </div>
    )
  }
}
