import { Component, createRef } from 'preact'
import type { ParcelMeta } from '../../../common/types'
import ndarray, { NdArray } from 'ndarray'
import { contours } from 'd3-contour'
import type { MapMarker, VoxelsMap } from '../helpers/load-voxels-map'
import { loadVoxelsMap } from '../helpers/load-voxels-map'
import { getVoxelsFromBuffer } from '../../../common/voxels/helpers'
import { CAMERA_HEIGHT, encodeCoords } from '../../../common/helpers/utils'
import { app } from '../state'
import { worldBoot } from '../client'
import { village, type VillageParcel } from './village'

const PAVEMENT_LEVEL = 1
const BLEED_MARGIN = 2
const PAGE_ORTHO = 2000

function getIslandGeometry(field: IslandField, center: vec2) {
  // Convert island field to a row-major flat array
  const grid = []

  // console.log(field)

  const height = field.shape[2]
  const width = field.shape[0]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid.push(field.get(x, PAVEMENT_LEVEL, y))
    }
  }

  // console.log(grid.length)
  // console.log(grid.filter((i) => i === 0).length)

  const granularize = (v: number) => Math.floor(v * 100) / 10000

  // d3-contour wants a flat array of numbers (row-major)
  const values = grid.flat()

  // console.log(values)

  // One binary threshold at 0.5 → outlines the 1s region(s)
  const cs = contours().size([width, height]).thresholds([0.5])(values) // returns an array; we used a single threshold

  // const bleedOffset = BLEED_MARGIN / 100

  // console.log(center)
  // console.log(width, height)

  const offsetX = center[0] - width / 200
  const offsetY = center[1] - height / 200

  // console.log('offsetX', offsetX, 'offsetY', offsetY)

  const geojson = {
    type: 'Polygon',
    coordinates: cs[0].coordinates.map((ring: any) => ring[0].map(([x, y]: any) => [granularize(x) + offsetX, granularize(y) + offsetY])),
  }

  // usage
  // const geometry = toIslandsMultiPolygon(cs)
  // // FeatureCollection if you want:
  // const geojson = {
  //   type: 'FeatureCollection',
  //   features: [{ type: 'Feature', properties: { threshold: 0.5 }, geometry }],
  // }

  // // If you want to scale to world units (e.g., each pixel = 0.25m), multiply coords:
  // const scale = 1.0 // change if you want
  // if (scale !== 1) {
  //   for (const f of geojson.features) {
  //     f.geometry.coordinates = f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [granularize(x * scale), granularize(y * scale)])))
  //   }
  // }

  return geojson
}

type vec2 = [number, number]
type vec4 = [number, number, number, number]

type ProspectiveParcel = ParcelMeta & Partial<VillageParcel>

export interface State {
  parcels: ProspectiveParcel[]
  start: number
  name: string
  streets: string
  // tileset png for every house, ugc bucket or any url
  atlas: string
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

  state: State = {
    parcels: [],
    start: 1,
    name: '',
    streets: '',
    atlas: 'https://ugc.voxels.com/tilesets/cyberpunk-v1.png',
    center: [11.14, -5.61],
    count: 100,
    reroll: 0,
    area: 60,
    areaSpread: 0.4,
    height: 8,
    heightSpread: 0.3,
    spawn: [0, 0],
  }

  componentDidMount() {
    this.fetch()
    this.createMap()
  }

  componentWillUnmount() {
    window.grid?.clearPreview()
    this.map?.dispose()
    this.map = null
    this.centerMarker = null
  }

  async fetch() {
    const response = await fetch(`/api/admin/parcels/top?nonce=${Math.random()}`)
    const { id } = await response.json()
    this.setState({ start: id })
  }

  build = (reroll: number) => {
    const streets = this.state.streets
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const { name, count, area, areaSpread, height, heightSpread } = this.state
    const { parcels, spawn } = village({ name, streets, count, reroll, area, areaSpread, height, heightSpread })
    parcels.forEach((p, i) => (p.id = i + 1 + this.state.start))
    this.setState({ parcels, reroll, spawn }, this.preview)
  }

  // teleport first so the island spawns around you, then post the proposal and drop it in
  preview = async () => {
    if (!this.state.parcels.length) return
    this.syncMap()
    const [cx, cz] = this.state.center
    const [sx, sz] = this.state.spawn
    await worldBoot()
    if (!window.persona) return app.showSnackbar('world not booted')
    window.persona.naviport(encodeCoords({ position: new BABYLON.Vector3(cx * 100 + sx, CAMERA_HEIGHT, cz * 100 + sz), rotation: BABYLON.Vector3.Zero() }))
    const res = await fetch('/api/admin/islands/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.buildBody()) })
    const json = await res.json().catch(() => ({}))
    if (!json.success) return app.showSnackbar(json.message || 'preview failed')
    this.map?.setProposal(json.island, json.parcels)
    try {
      await window.grid?.previewIsland(json.island, json.parcels)
    } catch (e) {
      console.error('island preview', e)
      app.showSnackbar('preview failed, see console')
    }
  }

  // island width and depth in metres
  extent(parcels: ProspectiveParcel[]) {
    return [Math.max(...parcels.map((p) => p.x2)) - Math.min(...parcels.map((p) => p.x1)), Math.max(...parcels.map((p) => p.z2)) - Math.min(...parcels.map((p) => p.z1))]
  }

  islandBody() {
    const { field } = getIslandField(this.state.parcels)
    return { name: this.state.name, geometry: this.getIslandGeometry(), content: { voxels: getVoxelsFromBuffer(field.data) } }
  }

  buildBody() {
    return { ...this.islandBody(), atlas: this.state.atlas, parcels: this.state.parcels.map((p) => ({ ...this.parcelPayload(p), door: p.door, material: p.material })) }
  }

  insertAll = async () => {
    const res = await fetch('/api/admin/islands/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.buildBody()) })
    const json = await res.json().catch(() => ({}))
    app.showSnackbar(json.success ? `${json.inserted} parcels inserted` : json.message || 'insert failed')
  }

  onSave = async (e: any) => {
    e.preventDefault()
    await fetch('/api/admin/islands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.islandBody()) })
    app.showSnackbar('island saved')
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
      this.setState({ parcels: JSON.parse(text).parcels }, this.preview)
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
    if (view !== this.mapView && this.state.parcels.length) {
      this.mapView = view
      const [w, d] = this.extent(this.state.parcels)
      this.map.fitBounds(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 2)
    }
    const html = `<span>${this.state.name || 'island'}</span>`
    if (this.centerMarker) {
      this.centerMarker.setPos(x, z)
      this.centerMarker.el.innerHTML = html
      return
    }
    this.centerMarker = this.map.addMarker({ x, z, className: 'island-label', html })
  }

  // Convert a designer parcel (local voxel coords) into the geo-coord payload the db wants.
  private parcelPayload(parcel: ProspectiveParcel) {
    const number = parcel.id - this.state.start
    const scale = 0.01
    return {
      id: parcel.id,
      address: parcel.address || `${number} ${this.state.name}`,
      island: this.state.name,
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

  private getIslandGeometry() {
    const { bounds, field } = getIslandField(this.state.parcels, true)
    const [x1, y1, x2, y2] = bounds.map((b) => b * 0.01)
    return getIslandGeometry(field, [this.state.center[0] + (x1 + x2) / 2, this.state.center[1] + (y1 + y2) / 2])
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
    const center = this.state.center.map((c) => c.toFixed(2)).join(',')
    return (
      <section class="island-admin">
        <header>
          <h1>Island Builder</h1>
          <p>Propose new islands for approval.</p>
        </header>

        <form>
          <div class="f">
            <label>Name</label>
            <input type="text" value={this.state.name} onChange={(e: any) => this.setState({ name: e.target.value }, this.syncMap)} />
          </div>

          <div class="f">
            <label>Streets, one per line</label>
            <textarea value={this.state.streets} onChange={(e: any) => this.setState({ streets: e.target.value })} />
          </div>

          <div class="f">
            <label>Atlas url</label>
            <input type="text" value={this.state.atlas} onChange={(e: any) => this.setState({ atlas: e.target.value.trim() })} />
          </div>

          <div class="f">
            <label>Center</label>
            <input type="text" value={center} onChange={(e: any) => this.setState({ center: e.target.value.split(',').map(Number) }, this.syncMap)} />
          </div>

          <div class="f">
            <label>Parcels</label>
            <input type="number" value={this.state.count} onChange={(e: any) => this.setState({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
          </div>

          {this.slider('area', 'Lot area m2', 10, 200, 5)}
          {this.slider('areaSpread', 'Lot area spread', 0, 1, 0.05)}
          {this.slider('height', 'Height m', 3, 30, 1)}
          {this.slider('heightSpread', 'Height spread', 0, 1, 0.05)}

          <button type="button" onClick={() => this.build(this.state.reroll)}>
            build
          </button>
          <button type="button" onClick={() => this.build(this.state.reroll + 1)}>
            reroll
          </button>
          <button type="button" onClick={this.insertAll}>
            insert all
          </button>

          <h5>Location</h5>

          <div class="island-map" ref={this.mapRef} />

          <button onClick={this.onSave}>Save</button>
        </form>
        <h3>Parcels</h3>

        <button onClick={this.download}>Download</button>
        <input type="file" accept=".json" onChange={this.upload} />

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Address</th>
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
                <td>{`${parcel.x1},${parcel.y1},${parcel.z1}`}</td>
                <td>{`${parcel.x2 - parcel.x1},${parcel.y2 - parcel.y1},${parcel.z2 - parcel.z1}`}</td>
                <td>
                  <button onClick={() => this.create(parcel)}>Insert</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }
}

type IslandField = NdArray<Uint16Array>

export function getIslandField(parcels: ProspectiveParcel[], hull = false): { bounds: vec4; field: IslandField } {
  if (parcels.length === 0) {
    throw new Error('No parcels provided')
  }

  const margin = BLEED_MARGIN
  // const splatMargin = 4

  let minX = Infinity,
    maxX = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (const p of parcels) {
    minX = Math.min(minX, p.x1)
    maxX = Math.max(maxX, p.x2)
    minZ = Math.min(minZ, p.z1)
    maxZ = Math.max(maxZ, p.z2)
  }

  // Grow bounds by 1 unit in all directions
  minX -= 1 + margin
  maxX += 1 + margin
  minZ -= 1 + margin
  maxZ += 1 + margin

  const bounds: vec4 = [minX, minZ, maxX, maxZ]

  const w = maxX - minX
  const h = 4
  const d = maxZ - minZ

  const solid = (1 << 15) + 0
  const border = (1 << 15) + 4

  const field = ndarray(new Uint16Array(w * h * d), [w, h, d])

  // console.log(minX, maxX, minZ, maxZ)
  // console.log(w, h)

  function occupied(x: number, z: number) {
    for (const p of parcels) {
      if (minX + x >= p.x1 && minX + x < p.x2 && minZ + z >= p.z1 && minZ + z < p.z2) {
        return true
      }
    }

    return false
  }

  function splat(x: number, z: number, radius: number, value: number) {
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        field.set(x + i, PAVEMENT_LEVEL, z + j, value)
      }
    }
  }
  // Bleed out parcels
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (occupied(x, z)) {
        splat(x, z, margin, solid)
      }
    }
  }

  // Parcel border (minisplat)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (occupied(x, z)) {
        splat(x, z, 1, border)
      }
    }
  }

  // Flood fill from edges
  const queue: [number, number][] = []

  // Push corners
  queue.push([0, 0], [0, h - 1], [w - 1, 0], [w - 1, h - 1])

  while (queue.length > 0) {
    const [x, z] = queue.shift()!
    if (x < 0 || x >= w || z < 0 || z >= d) continue
    if (field.get(x, PAVEMENT_LEVEL, z) !== 0) continue

    field.set(x, PAVEMENT_LEVEL, z, 2) // mark as water-accessible

    queue.push([x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1])
  }

  // All remaining 0s are enclosed: mark them as ground (1)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 0) {
        field.set(x, PAVEMENT_LEVEL, z, solid)
      }
    }
  }

  // Null out parcels
  if (!hull) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        if (occupied(x, z)) {
          field.set(x, PAVEMENT_LEVEL, z, 0)
        }
      }
    }
  }

  // Delete the ocean
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 2) {
        field.set(x, PAVEMENT_LEVEL, z, 0)
      }
    }
  }

  return { bounds, field }
}
