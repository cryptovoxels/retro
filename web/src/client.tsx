import { Component, createRef } from 'preact'
import { route } from 'preact-router'
import { canUseDom } from '../../common/helpers/utils'
import { getCoords, notifyUrlChange, syncParcelUrl } from './helpers/coords-nav'
import { app } from './state'
import type { BootResult } from '../../src'

function boot(): Promise<BootResult> {
  return import(/* webpackMode: "eager" */ '../../src').then((m) => m.bootEngine())
}

type FrameProps = {
  coords: string
}

type FrameState = { ui?: BootResult }

export class Client extends Component<FrameProps, FrameState> {
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null
  watch: ReturnType<typeof setInterval> | null = null

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
  }

  componentWillUnmount() {
    this.observer?.disconnect()
    this.observer = null
    if (this.watch) clearInterval(this.watch)
    this.watch = null

    const canvas = document.getElementById('renderCanvas')
    if (canvas && this.box.current?.contains(canvas)) {
      if (app.playPreview.value) {
        document.getElementById('world-preview')?.appendChild(canvas)
        window.engine?.resize()
      } else {
        document.getElementById('world-holder')?.appendChild(canvas)
      }
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
    document.body.classList.add('in-world')

    this.syncCoordsUrl()

    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => window.engine?.resize())
    this.observer.observe(box)
    window.engine?.resize()

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
      <>
        <div class="client-placeholder" ref={this.box} />
        {ui && <ui.UI {...ui.props} />}
      </>
    )
  }
}
