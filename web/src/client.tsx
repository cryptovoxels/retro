import { Component, createRef } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom } from '../../common/helpers/utils'
import { wantsLite, wantsNoUI } from '../../common/helpers/detector'
import type { BootResult } from '../../src'
import { pushSpaceHistory, realmSavedCoords, saveRealmCoords } from '../../src/init/realm'
import { spaceW } from '../../src/utils/space-w'
import cachedFetch from './helpers/cached-fetch'
import { Spinner } from './spinner'
import { getCoords, getParcelIdFromPath, getSpaceIdFromPath, isSpacePath, isSpacePlayPath } from './helpers/coords-nav'
import { app, AppEvent } from './state'
import { currentOrNearestParcel } from '../../src/store'

/** Memoised engine boot; safe to await from anywhere that needs window.persona / window.grid. */
export function worldBoot(): Promise<BootResult | null> {
  if (wantsLite()) return import('../../src/lite').then((m) => m.bootLite())
  return import('../../src').then((m) => m.bootEngine())
}

const boot = worldBoot

type FrameProps = {
  coords: string
  path?: string
}

type FrameState = { ui?: BootResult | null; ready?: boolean; error?: boolean }

export class Client extends Component<FrameProps, FrameState> {
  root = createRef<HTMLDivElement>()
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null
  revealObserver: BABYLON.Observer<BABYLON.Scene> | null = null

  componentDidMount() {
    if (!canUseDom) return
    void boot()
      .then((ui) => {
        this.setState({ ui })
        return this.syncRealm(this.props.path)
      })
      .then(() => this.adopt())
      .catch((e) => {
        console.error('[boot]', e)
        this.setState({ error: true })
      })
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
    window.scene?.onAfterRenderObservable.remove(this.revealObserver)
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
      await grid.switchWorld(0, undefined, getCoords() || realmSavedCoords())
    })
  }

  private async adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) return

    box.appendChild(canvas)
    canvas.style.visibility = 'hidden'
    canvas.style.display = 'block'
    const id = getParcelIdFromPath(this.props.path)
    if (id && !isSpacePlayPath(this.props.path)) await this.gotoParcel(id)
    this.watchSize()
    window.engine?.resize()
    if (wantsLite()) {
      canvas.style.visibility = ''
      this.setState({ ready: true })
      return
    }
    const grid = window.grid!
    const scene = window.scene
    const parcels = await grid.startupParcels()
    if (!box.isConnected) return
    let frames = 0
    this.revealObserver = scene.onAfterRenderObservable.add(() => {
      frames = grid.startupReady(parcels) ? frames + 1 : 0
      if (frames < 2) return
      scene.onAfterRenderObservable.remove(this.revealObserver)
      this.revealObserver = null
      canvas.style.visibility = ''
      this.setState({ ready: true })
    })
  }

  private watchSize() {
    this.observer?.disconnect()
    const root = this.root.current
    if (!root) return
    this.observer = new ResizeObserver(() => window.engine?.resize())
    this.observer.observe(root)
  }

  private gotoParcel(id: number) {
    // already here or next to it (location label click), don't teleport
    if (window.grid?.currentParcel()?.id === id || currentOrNearestParcel.value?.id === id) return
    return cachedFetch(`/api/parcels/${id}.json`)
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
          {!this.state.ready && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{this.state.error ? <button onClick={() => location.reload()}>Could not load the world. Try again.</button> : <Spinner size={48} />}</div>
          )}
        </div>
        {this.state.ready && ui && !wantsNoUI() && <ui.UI {...ui.props} />}
      </>
    )
  }
}
