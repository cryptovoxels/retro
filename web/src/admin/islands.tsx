import { Component, createRef } from 'preact'
import type { ParcelMeta } from '../../../common/types'
import type { MapMarker, VoxelsMap } from '../helpers/load-voxels-map'
import { loadVoxelsMap } from '../helpers/load-voxels-map'
import { runCompute } from '../../../src/mono-pool'
import { CAMERA_HEIGHT, decodeCoords } from '../../../common/helpers/utils'
import { app } from '../state'
import { worldBoot } from '../client'
import type { Road } from '../../../islands/texas/layout'
import type { VillageParcel } from './village'

const PAGE_ORTHO = 2000
type vec2 = [number, number]

type ProspectiveParcel = ParcelMeta & Partial<VillageParcel>

export interface State {
  parcels: ProspectiveParcel[]
  roads: Road[]
  status: string
  progress: number
  showParcels: boolean
  start: number
  name: string
  streets: string
  // tileset png for every house, ugc bucket or any url
  atlas: string
  artpack: string
  center: vec2
  count: number
  reroll: number
  area: number
  areaSpread: number
  height: number
  heightSpread: number
  // where to stand, island metres
  spawn: [number, number]
}

// The proposal renders in the live world behind this page: build posts it to the no-write preview
// endpoint, the grid drops the island and parcels in, and you get flown to the center.
export default class IslandsAdmin extends Component<{}, State> {
  map: VoxelsMap | null = null
  mapRef = createRef<HTMLDivElement>()
  centerMarker: MapMarker | null = null
  mapView = ''
  revision = 0

  state: State = {
    parcels: [],
    roads: [],
    status: 'loading builder',
    progress: 0,
    showParcels: false,
    start: 1,
    name: '',
    streets: '',
    atlas: 'https://ugc.voxels.com/tilesets/concrete-v1.png',
    center: [11.14, -5.61],
    artpack: '',
    count: 100,
    reroll: 0,
    area: 60,
    areaSpread: 0.4,
    height: 8,
    heightSpread: 0.3,
    spawn: [0, 0],
  }

  private arrival = new URLSearchParams(location.search).get('coords')

  componentDidMount() {
    this.fetch().catch(() => this.stage('could not load builder', 0))
    this.createMap()
  }

  componentWillUnmount() {
    this.revision++
    window.grid?.clearPreview()
    this.map?.dispose()
    this.map = null
    this.centerMarker = null
  }

  async fetch() {
    const response = await fetch(`/api/admin/parcels/top?nonce=${Math.random()}`)
    const { id } = await response.json()
    const slug = new URLSearchParams(location.search).get('draft')
    if (!slug) return this.setState({ start: id, status: 'ready' })
    try {
      const res = await fetch('/api/admin/island-drafts/' + encodeURIComponent(slug), { cache: 'no-store' })
      if (!res.ok && !(res.status === 404 && slug === 'texas')) throw new Error()
      const { settings, ground, content } = res.ok ? await res.json() : { settings: (await import('../../../islands/texas/draft.json')).default }
      if (!this.mapRef.current) return
      this.setState({ ...settings, start: id }, () => this.build(settings.reroll, ground, settings.artpack !== 'texas-thrift' || content?.furnitureVersion === 3 ? content?.features : undefined))
    } catch {
      this.setState({ start: id })
      this.stage('could not load island draft', 0)
    }
  }

  stage(status: string, progress: number) {
    this.setState({ status, progress })
  }

  async proposal(reroll: number) {
    const streets = this.state.streets
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const { name, count, area, areaSpread, height, heightSpread } = this.state
    const { parcels, roads, spawn } = await runCompute((w) => w.islandLayout({ name, streets, count, reroll, area, areaSpread, height, heightSpread }))
    parcels.forEach((p, i) => (p.id = i + 1 + this.state.start))
    return { parcels, roads, reroll, spawn }
  }

  build = async (reroll: number, ground?: string, features?: any[]) => {
    const revision = ++this.revision
    this.stage('laying out streets and parcels', 1)
    try {
      const proposal = await this.proposal(reroll)
      if (this.revision !== revision) return
      this.setState(proposal, () => this.preview(ground, features))
    } catch {
      if (this.revision === revision) this.stage('layout failed', 0)
    }
  }

  preview = async (savedGround?: string, features?: any[]) => {
    if (!this.state.parcels.length) return this.stage('no parcels generated', 0)
    const revision = ++this.revision
    try {
      this.syncMap()
      this.stage('painting ground and tracing shoreline', 2)
      const body = await this.buildBody()
      if (this.revision !== revision) return
      if (savedGround && savedGround === body.ground) {
        body.ground = savedGround
        if (features) body.content.features = features
      }
      this.stage('building houses and placing art', 3)
      const res = await fetch('/api/admin/islands/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (this.revision !== revision) return
      if (!json.success) return this.stage(json.message || 'preview failed', 0)
      this.stage('loading world', 4)
      await worldBoot()
      if (this.revision !== revision) return
      await window.grid?.switchWorld(0)
      if (this.revision !== revision) return
      if (!window.persona || !window.grid) return this.stage('world not ready', 0)
      this.map?.setProposal(json.island, json.parcels)
      this.stage('adding parcels to the grid', 5)
      await window.grid.previewIsland(json.island, json.parcels, (done) => {
        if (this.revision === revision) this.stage('adding parcels: ' + done + ' / ' + json.parcels.length, 5 + done / json.parcels.length)
      })
      if (this.revision !== revision) return
      if (this.arrival) {
        window.persona.teleport(decodeCoords(this.arrival), false)
        this.arrival = null
      } else this.visitSpawn()
      this.stage('preview ready - ' + json.parcels.length + ' parcels', 7)
    } catch {
      if (this.revision === revision) this.stage('could not build preview', 0)
    }
  }

  visitSpawn = () => {
    const [cx, cz] = this.state.center,
      [sx, sz] = this.state.spawn
    const creek = !!this.state.parcels[0]?.suburb
    window.persona?.teleport({ position: new BABYLON.Vector3(cx * 100 + sx, CAMERA_HEIGHT + (this.state.parcels[0]?.y1 || 0) + 1, cz * 100 + sz), rotation: new BABYLON.Vector3(creek ? 0.15 : 0, creek ? Math.PI / 2 : 0, 0) }, false)
  }

  // island width and depth in metres
  extent(parcels: ProspectiveParcel[]) {
    return [Math.max(...parcels.map((p) => p.x2)) - Math.min(...parcels.map((p) => p.x1)), Math.max(...parcels.map((p) => p.z2)) - Math.min(...parcels.map((p) => p.z1))]
  }

  async islandBody({ parcels, roads }: Pick<State, 'parcels' | 'roads'> = this.state) {
    const { artpack, center, reroll } = this.state
    const surface = await runCompute((worker) => worker.islandSurface(parcels, roads, artpack, center, reroll))
    return { name: this.state.name, ...surface }
  }

  async buildBody() {
    return { ...(await this.islandBody()), atlas: this.state.atlas, artpack: this.state.artpack, parcels: this.state.parcels.map((p) => ({ ...this.parcelPayload(p), door: p.door, material: p.material })) }
  }

  insertAll = async () => {
    this.stage('preparing island for insertion', 2)
    try {
      const body = await this.buildBody()
      this.stage('inserting island and parcels', 4)
      const res = await fetch('/api/admin/islands/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      this.stage(json.success ? `${json.inserted} parcels inserted` : json.message || 'insert failed', json.success ? 7 : 0)
    } catch {
      this.stage('insert failed', 0)
    }
  }

  saveDraft = async () => {
    const { name, count, center, reroll, area, areaSpread, height, heightSpread, atlas, streets, artpack } = this.state
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!slug) return app.showSnackbar('draft needs a name')
    try {
      this.stage('preparing draft ground', 2)
      const proposal = await this.proposal(reroll)
      const surface = proposal.parcels.length ? await this.islandBody(proposal) : undefined
      this.stage('saving draft', 5)
      const res = await fetch('/api/admin/island-drafts/' + slug, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, count, center, reroll, area, areaSpread, height, heightSpread, atlas, streets, artpack, ground: surface?.ground, content: surface?.content }),
      })
      if (!res.ok) throw new Error()
      const url = new URL(location.href)
      url.pathname = '/admin/island'
      url.searchParams.set('draft', slug)
      history.replaceState(history.state, '', url)
      this.stage('draft saved', 7)
    } catch {
      this.stage('could not save draft', 0)
    }
  }

  onSave = async () => {
    try {
      this.stage('saving island terrain', 3)
      const res = await fetch('/api/admin/islands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await this.islandBody()) })
      const json = await res.json()
      this.stage(json.success ? 'island saved' : json.message || 'save failed', json.success ? 7 : 0)
    } catch {
      this.stage('save failed', 0)
    }
  }

  download = () => {
    const blob = new Blob([JSON.stringify({ parcels: this.state.parcels })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'islands.json'
    a.click()
  }

  upload = async (e: any) => {
    const text = await e.target.files[0].text()
    try {
      this.setState({ roads: [], parcels: JSON.parse(text).parcels }, this.preview)
    } catch {
      app.showSnackbar('bad json')
    }
  }

  async createMap() {
    const el = this.mapRef.current
    if (!el || this.map) return
    el.style.position = 'relative'
    el.style.height = '16rem'
    const canvas = document.createElement('canvas')
    canvas.className = 'voxels-map'
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none'
    el.appendChild(canvas)

    const { VoxelsMap } = await loadVoxelsMap()
    this.map = new VoxelsMap(canvas, {
      ortho: PAGE_ORTHO / 2,
      parcels: true,
      onClick: (x, z) => this.setState({ center: [x / 100, z / 100] }, this.syncMap),
    })
    this.map.setView(this.state.center[0] * 100, this.state.center[1] * 100)
    this.map.load().catch((e) => console.error('admin island map load failed', e))
    this.syncMap()
  }

  // marker on the center, zoomed onto the proposal whenever it moves or gets rebuilt
  syncMap = () => {
    if (!this.map) return
    const x = this.state.center[0] * 100
    const z = this.state.center[1] * 100
    const view = `${x},${z},${this.state.parcels.length}`
    if (view !== this.mapView && !this.state.parcels.length) this.map.setView(x, z)
    if (view !== this.mapView && this.state.parcels.length) {
      const [w, d] = this.extent(this.state.parcels)
      this.map.fitBounds(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 2)
    }
    this.mapView = view
    if (this.centerMarker) {
      this.centerMarker.setPos(x, z)
    } else {
      this.centerMarker = this.map.addMarker({ x, z, className: 'island-label', html: '<span></span>' })
    }
    this.centerMarker.el.querySelector('span')!.textContent = this.state.name || 'island'
  }

  // Convert a designer parcel (local voxel coords) into the geo-coord payload the db wants.
  private parcelPayload(parcel: ProspectiveParcel) {
    const number = parcel.id - this.state.start
    const scale = 0.01
    return {
      id: parcel.id,
      address: parcel.address || `${number} ${this.state.name}`,
      island: this.state.name,
      suburb: parcel.suburb,
      owner: app.state.wallet || '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2',
      x1: parcel.x1 * scale + this.state.center[0],
      y1: parcel.y1,
      z1: parcel.z1 * scale + this.state.center[1],
      x2: parcel.x2 * scale + this.state.center[0],
      y2: parcel.y2,
      z2: parcel.z2 * scale + this.state.center[1],
    }
  }

  async create(parcel: ProspectiveParcel) {
    await fetch('/api/admin/parcels/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.parcelPayload(parcel)) })
  }

  // uncontrolled so preact never writes the value back mid drag, build and reroll read the state
  slider(key: 'area' | 'areaSpread' | 'height' | 'heightSpread', label: string, min: number, max: number, step: number) {
    return (
      <div class="f">
        <label>
          {label}: {this.state[key]}
        </label>
        <input type="range" min={min} max={max} step={step} defaultValue={String(this.state[key])} onInput={(e: any) => this.setState({ [key]: Number(e.target.value) } as any)} />
      </div>
    )
  }

  render() {
    const busy = this.state.progress > 0 && this.state.progress < 7
    const center = this.state.center.map((c) => c.toFixed(2)).join(',')
    return (
      <section class="island-admin">
        <header>
          <h1>Island Builder</h1>
        </header>

        <form onSubmit={(e) => e.preventDefault()}>
          <fieldset disabled={busy || this.state.status === 'loading builder'} style={{ border: 0, padding: 0, margin: 0 }}>
            <div class="f">
              <label>Name</label>
              <input type="text" value={this.state.name} onChange={(e: any) => this.setState({ name: e.target.value }, this.syncMap)} />
            </div>

            <details>
              <summary>parameters</summary>
              <div class="f">
                <label>Streets, one per line</label>
                <textarea value={this.state.streets} onChange={(e: any) => this.setState({ streets: e.target.value })} />
              </div>

              <div class="f">
                <label for="island-artpack">Artpack</label>
                <select id="island-artpack" value={this.state.artpack} onChange={(e) => this.setState({ artpack: e.currentTarget.value })}>
                  <option value="">custom atlas</option>
                  <option value="texas-thrift">Texas thrift</option>
                </select>
              </div>
              {!this.state.artpack && (
                <div class="f">
                  <label>Atlas url</label>
                  <input type="text" value={this.state.atlas} onChange={(e: any) => this.setState({ atlas: e.target.value.trim() })} />
                </div>
              )}

              <div class="f">
                <label>Center</label>
                <input
                  type="text"
                  value={center}
                  onChange={(e: any) => {
                    const parts = e.target.value.split(',').map((part: string) => part.trim())
                    if (parts.length !== 2 || parts.some((part: string) => !part || !Number.isFinite(Number(part)))) {
                      e.target.value = center
                      return app.showSnackbar('enter center as x,z')
                    }
                    this.setState({ center: [Number(parts[0]), Number(parts[1])] }, this.syncMap)
                  }}
                />
              </div>

              <div class="f">
                <label>Parcels</label>
                <input type="number" value={this.state.count} onChange={(e: any) => this.setState({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              </div>

              {this.slider('area', 'Lot area m2', 10, 200, 5)}
              {this.slider('areaSpread', 'Lot area spread', 0, 1, 0.05)}
              {this.slider('height', 'Height m', 3, 30, 1)}
              {this.slider('heightSpread', 'Height spread', 0, 1, 0.05)}
            </details>
            <button type="button" onClick={() => this.build(this.state.reroll)}>
              build
            </button>
            <button type="button" onClick={() => this.build(this.state.reroll + 1)}>
              regenerate
            </button>
            <button type="button" disabled={!this.state.parcels.length || !this.state.name.trim()} onClick={this.insertAll}>
              insert all
            </button>

            <button type="button" disabled={!this.state.name.trim()} onClick={this.saveDraft}>
              save draft
            </button>
          </fieldset>
          <progress aria-label="island generation" max={7} value={this.state.progress} />
          <div role="status">{this.state.status}</div>
          <h5>Location</h5>
          {this.state.parcels[0]?.suburb && (
            <button type="button" disabled={busy} onClick={this.visitSpawn}>
              visit creek
            </button>
          )}

          <div class="island-map" ref={this.mapRef} />

          <button type="button" disabled={busy || !this.state.parcels.length || !this.state.name.trim()} onClick={this.onSave}>
            save island terrain
          </button>
        </form>
        <details onToggle={(e) => this.setState({ showParcels: e.currentTarget.open })}>
          <summary>parcels ({this.state.parcels.length})</summary>
          {this.state.showParcels && (
            <>
              <button onClick={this.download}>Download</button>
              <input type="file" accept=".json" onChange={this.upload} />

              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Address</th>
                    <th>Suburb</th>
                    <th>Position</th>
                    <th>Size</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {this.state.parcels.map((parcel) => (
                    <tr key={parcel.id}>
                      <td>
                        <a href={`/parcels/${parcel.id}`}>{parcel.id}</a>
                      </td>
                      <td>{parcel.address}</td>
                      <td>{parcel.suburb}</td>
                      <td>{`${parcel.x1},${parcel.y1},${parcel.z1}`}</td>
                      <td>{`${parcel.x2 - parcel.x1},${parcel.y2 - parcel.y1},${parcel.z2 - parcel.z1}`}</td>
                      <td>
                        <button onClick={() => this.create(parcel)}>Insert</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </details>
      </section>
    )
  }
}
