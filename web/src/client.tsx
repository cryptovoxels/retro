import { Component, createRef } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom } from '../../common/helpers/utils'
import { wantsNoUI } from '../../common/helpers/detector'
import type { BootResult } from '../../src'
import cachedFetch from './helpers/cached-fetch'
import { getCoords, getParcelIdFromPath, syncParcelUrl } from './helpers/coords-nav'
import { app, AppEvent } from './state'

function boot(): Promise<BootResult> {
  return import(/* webpackMode: "eager" */ '../../src').then((m) => m.bootEngine())
}

type FrameProps = {
  coords: string
  path?: string
}

type FrameState = { ui?: BootResult }

export class Client extends Component<FrameProps, FrameState> {
  root = createRef<HTMLDivElement>()
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null

  componentDidMount() {
    if (!canUseDom) return
    document.body.classList.add('in-world')
    void boot().then((ui) => {
      this.setState({ ui })
      this.adopt()
    })
    app.on(AppEvent.Exploring, this.onExplore)
  }

  componentDidUpdate(prev: Readonly<FrameProps>) {
    if (prev.coords !== this.props.coords && this.props.coords) this.naviport()
    const id = getParcelIdFromPath(this.props.path)
    const prevId = getParcelIdFromPath(prev.path)
    if (id && id !== prevId) this.gotoParcel(id)
    window.engine?.resize()
  }

  componentWillUnmount() {
    this.observer?.disconnect()
    app.removeListener(AppEvent.Exploring, this.onExplore)
    document.body.classList.remove('in-world')
  }

  private onExplore = () => {
    const id = window.grid?.currentParcel()?.id
    if (id) syncParcelUrl(id)
  }

  private adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) return

    box.appendChild(canvas)
    canvas.style.display = 'block'
    this.naviport()
    const id = getParcelIdFromPath(this.props.path)
    if (id) this.gotoParcel(id)
    this.watchSize()
  }

  private watchSize() {
    this.observer?.disconnect()
    const root = this.root.current
    if (!root) return
    this.observer = new ResizeObserver(() => window.engine?.resize())
    this.observer.observe(root)
  }

  private gotoParcel(id: number) {
    if (window.grid?.currentParcel()?.id === id) return
    void cachedFetch(`/api/parcels/${id}.json`)
      .then((r) => r.json())
      .then((d) => {
        if (window.grid?.currentParcel()?.id === id) return
        const c = d.parcel ? new ParcelHelper(d.parcel).spawnCoords : ''
        if (c) window.persona?.naviport(c)
      })
      .catch(() => {})
  }

  private naviport() {
    const coords = this.props.coords || getCoords()
    if (!coords) return
    void boot().then(() => {
      try {
        window.persona?.naviport(coords)
      } catch (e) {
        console.error(e)
      }
    })
  }

  render() {
    const ui = this.state.ui
    return (
      <>
        <div class="client" ref={this.root}>
          <div class="client-canvas" ref={this.box} />
        </div>
        {ui && !wantsNoUI() && <ui.UI {...ui.props} />}
      </>
    )
  }
}
