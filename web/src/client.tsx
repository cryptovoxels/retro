import { Component, createRef } from 'preact'
import { route } from 'preact-router'
import { canUseDom } from '../../common/helpers/utils'
import { app } from './state'
import type { BootResult } from '../../src'

// Lazily evaluate the engine. Dynamic import keeps src/** out of the SSR import
// graph (it pulls in shaders + babylon, which tsx can't parse). webpackMode
// "eager" keeps it in the single app.js bundle for the browser.
function boot(): Promise<BootResult> {
  return import(/* webpackMode: "eager" */ '../../src').then((m) => m.bootEngine())
}

type FrameProps = {
  full?: boolean
  parcelId?: number
  coords: string
}

type FrameState = { ui?: BootResult }

/*
 * THE GREAT MERGE: this used to spin up an <iframe src="/play">. Now the engine
 * lives in the same bundle on a single persistent canvas. We reparent that one
 * canvas into our .client-placeholder box on mount and park it back in
 * #world-holder on unmount, so the WebGL context survives navigation.
 */
export class Client extends Component<FrameProps, FrameState> {
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null
  watch: ReturnType<typeof setInterval> | null = null
  skipNaviport = false
  static parcelId: number | null = null

  componentDidMount() {
    Client.parcelId = this.props.parcelId!
    if (!canUseDom) {
      return
    }
    void boot().then((ui) => {
      this.setState({ ui })
      this.adopt()
    })
  }

  componentDidUpdate(previousProps: Readonly<FrameProps>): void {
    if (this.props.parcelId == previousProps.parcelId) return

    Client.parcelId = this.props.parcelId!
    // walking into another parcel updates the url -- sync chrome only, don't naviport
    if (this.skipNaviport) {
      this.skipNaviport = false
      return
    }
    this.naviport()
  }

  componentWillUnmount() {
    this.observer?.disconnect()
    this.observer = null
    if (this.watch) clearInterval(this.watch)
    this.watch = null

    // only park the canvas if we still own it (a newly-mounted Client may have
    // already adopted it during the route transition).
    const canvas = document.getElementById('renderCanvas')
    if (canvas && this.box.current?.contains(canvas)) {
      if (app.playPreview.value) {
        document.getElementById('world-preview')?.appendChild(canvas)
        window.engine?.resize()
      } else {
        document.getElementById('world-holder')?.appendChild(canvas)
      }
    }

    // leaving the world: drop the in-world skin so client.less stops painting over
    // web pages (the UI itself unmounts with this component)
    document.body.classList.remove('in-world')
    document.documentElement.classList.remove('in-world-theatre')
    document.body.classList.remove('in-world-theatre')
  }

  // pull the one persistent canvas into our box and keep the engine sized to it
  private adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) {
      return
    }

    box.appendChild(canvas)
    document.body.classList.add('in-world')
    if (this.props.full) {
      document.documentElement.classList.add('in-world-theatre')
      document.body.classList.add('in-world-theatre')
    }

    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => window.engine?.resize())
    this.observer.observe(box)
    window.engine?.resize()

    this.naviport()

    // while embedded on a parcel page, reflect the parcel you walk into into the URL.
    // route() re-renders <Parcel> -> its componentDidUpdate refetches the aside/header.
    if (this.watch) clearInterval(this.watch)
    this.watch = setInterval(() => {
      if (!location.pathname.startsWith('/parcels/')) return
      const id = window.grid?.currentParcel()?.id
      if (id && id !== this.props.parcelId) {
        this.skipNaviport = true
        const coords = new URLSearchParams(location.search).get('coords') || ''
        route(`/parcels/${id}?coords=${coords}`, true)
      }
    }, 200)
  }

  // teleport once the engine is up
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
