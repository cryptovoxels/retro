import { Component, createRef } from 'preact'
import ParcelHelper from '../../common/helpers/parcel-helper'
import { canUseDom, decodeCoords } from '../../common/helpers/utils'
import { wantsNoUI } from '../../common/helpers/detector'
import type { BootResult } from '../../src'
import { realmSavedCoords, saveRealmCoords } from '../../src/init/realm'
import { spaceW } from '../../src/utils/space-w'
import cachedFetch from './helpers/cached-fetch'
import { markLoaded } from '../../src/utils/loading-done'
import { getCoords, getParcelIdFromPath, getSpaceIdFromPath } from './helpers/coords-nav'
import { currentOrNearestParcel } from '../../src/store'

/** Memoised engine boot; safe to await from anywhere that needs window.persona / window.grid. */
export function worldBoot(): Promise<BootResult | null> {
  return import('../../src').then((m) => m.bootEngine())
}

const boot = worldBoot

type FrameProps = {
  path?: string
}

type FrameState = { ui?: BootResult | null; ready?: boolean; error?: boolean }

export class Client extends Component<FrameProps, FrameState> {
  root = createRef<HTMLDivElement>()
  box = createRef<HTMLDivElement>()
  observer: ResizeObserver | null = null
  spawnCoords = getCoords()

  componentDidMount() {
    if (!canUseDom) return
    window.addEventListener('popstate', this.restore)
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
    if (getSpaceIdFromPath(prev.path) !== getSpaceIdFromPath(this.props.path)) void this.syncRealm(this.props.path)
    const id = getParcelIdFromPath(this.props.path)
    const prevId = getParcelIdFromPath(prev.path)
    if (id && id !== prevId && !getCoords()) this.gotoParcel(id)
    window.engine?.resize()
  }

  componentWillUnmount() {
    this.observer?.disconnect()
    window.removeEventListener('popstate', this.restore)
  }

  private syncRealm(path?: string): Promise<void> {
    const coords = getCoords()
    return boot().then(async () => {
      const grid = window.grid
      if (!grid || (path && path !== location.pathname)) return
      const spaceId = getSpaceIdFromPath(path)
      if (spaceId) {
        if (grid.currentW === 0) {
          saveRealmCoords()
        }
        await grid.switchWorld(spaceW(spaceId), spaceId, coords || undefined)
        return
      }
      await grid.switchWorld(0, undefined, coords || realmSavedCoords())
    })
  }

  private adopt() {
    const canvas = document.getElementById('renderCanvas')
    const box = this.box.current
    if (!canvas || !box) return

    box.appendChild(canvas)
    canvas.style.visibility = ''
    canvas.style.display = 'block'
    const id = getParcelIdFromPath(this.props.path)
    if (id && !this.spawnCoords) void this.gotoParcel(id)
    this.watchSize()
    window.engine?.resize()
    markLoaded()
    this.setState({ ready: true })
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
    return this.syncRealm(this.props.path)
      .then(() => cachedFetch(`/api/parcels/${id}.json`))
      .then((r) => r.json())
      .then((d) => {
        if (getParcelIdFromPath(this.props.path) !== id || window.grid?.currentParcel()?.id === id) return
        const c = d.parcel ? new ParcelHelper(d.parcel).spawnCoords : ''
        if (c) window.persona?.teleport(decodeCoords(c), false)
      })
      .catch(() => {})
  }

  private restore = async () => {
    const href = location.href
    const coords = getCoords()
    try {
      await this.syncRealm(location.pathname)
      if (location.href === href && coords) window.persona?.teleport(decodeCoords(coords), false)
    } catch (error) {
      console.error(error)
    }
  }

  render() {
    const ui = this.state.ui
    return (
      <>
        <div class="client" ref={this.root}>
          <div class="client-canvas" ref={this.box} />
          {this.state.error && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <button onClick={() => location.reload()}>Could not load the world. Try again.</button>
            </div>
          )}
        </div>
        {this.state.ready && ui && !wantsNoUI() && <ui.UI {...ui.props} />}
      </>
    )
  }
}
