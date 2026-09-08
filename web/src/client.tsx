import { Component, createRef } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom } from '../../common/helpers/utils'
import { wantsLite, wantsNoUI } from '../../common/helpers/detector'
import type { BootResult } from '../../src'
import { pushSpaceHistory, realmSavedCoords, saveRealmCoords } from '../../src/init/realm'
import { spaceW } from '../../src/utils/space-w'
import cachedFetch from './helpers/cached-fetch'
import { getCoords, getParcelIdFromPath, getSpaceIdFromPath, isSpacePath, isSpacePlayPath, isWorldRoute, syncParcelUrl } from './helpers/coords-nav'
import { app, AppEvent } from './state'

function boot(): Promise<BootResult | null> {
  if (wantsLite()) return import('../../src/lite').then((m) => m.bootLite())
  return import(/* webpackMode: "eager" */ '../../src').then((m) => m.bootEngine())
}

type FrameProps = {
  coords: string
  path?: string
}

type FrameState = { ui?: BootResult | null }

export class Client extends Component<FrameProps, FrameState> {
  root = createRef<HTMLDivElement>()
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null

  componentDidMount() {
    if (!canUseDom) return
    document.body.classList.add('in-world')
    void boot()
      .then((ui) => {
        this.setState({ ui })
        return this.syncRealm(this.props.path)
      })
      .then(() => this.adopt())
      .catch((e) => {
        console.error('[boot]', e)
        window.graphic?.postProcesses?.reveal()
        this.adopt()
      })
    app.on(AppEvent.Exploring, this.onExplore)
  }

  componentDidUpdate(prev: Readonly<FrameProps>) {
    if (prev.path !== this.props.path) this.syncRealm(this.props.path, prev.path)
    if (prev.coords !== this.props.coords && this.props.coords && !isSpacePath(this.props.path)) this.naviport()
    const id = getParcelIdFromPath(this.props.path)
    const prevId = getParcelIdFromPath(prev.path)
    if (id && id !== prevId && !isSpacePlayPath(this.props.path)) this.gotoParcel(id)
    window.engine?.resize()
  }

  componentWillUnmount() {
    this.observer?.disconnect()
    app.removeListener(AppEvent.Exploring, this.onExplore)
    document.body.classList.remove('in-world')
  }

  private syncRealm(path?: string, prevPath?: string): Promise<void> {
    return boot().then(async () => {
      const grid = window.grid
      if (!grid) return
      const spaceId = getSpaceIdFromPath(path)
      if (spaceId) {
        if (grid.currentW === 0) {
          if (prevPath && !isSpacePath(prevPath)) pushSpaceHistory(spaceId)
          else saveRealmCoords()
        }
        const coords = getCoords() || undefined
        await grid.switchWorld(spaceW(spaceId), spaceId, coords)
        return
      }
      if (isWorldRoute(path)) {
        await grid.switchWorld(0, undefined, realmSavedCoords())
        return
      }
      window.graphic?.postProcesses?.reveal()
    })
  }

  private onExplore = () => {
    const id = window.grid?.currentParcel()?.id
    if (typeof id === 'number') syncParcelUrl(id)
  }

  private adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) return

    box.appendChild(canvas)
    canvas.style.display = 'block'
    const id = getParcelIdFromPath(this.props.path)
    if (id && !isSpacePlayPath(this.props.path)) this.gotoParcel(id)
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
