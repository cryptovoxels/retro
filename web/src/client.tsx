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
    this.naviport()

    if (this.watch) clearInterval(this.watch)
    this.watch = setInterval(() => {
      if (!getCoords()) return
      if (location.pathname === '/parcels') return
      const m = location.pathname.match(/^\/parcels\/(\d+)$/)
      if (!m) return
      const urlId = parseInt(m[1], 10)
      const id = window.grid?.currentParcel()?.id
      if (id && id !== urlId) {
        syncParcelUrl(id)
      }
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

    if (this.props.mode === 'full') {
      root.style.top = ''
      root.style.left = ''
      root.style.width = ''
      root.style.height = ''
      window.engine?.resize()
      return
    }

    const slot = document.querySelector('.client-slot') as HTMLElement | null
    if (!slot) return

    const fit = () => {
      const r = slot.getBoundingClientRect()
      root.style.top = `${r.top + window.scrollY}px`
      root.style.left = `${r.left + window.scrollX}px`
      root.style.width = `${r.width}px`
      root.style.height = `${r.height}px`
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
