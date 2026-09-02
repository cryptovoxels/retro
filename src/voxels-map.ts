import { getParcelHelper } from '../common/helpers/parcel-helper'
import { ParcelRecord } from '../common/messages/parcel'

export const OCEAN = new BABYLON.Color4(0.19, 0.44, 0.54, 1)

export interface ParcelData {
  id: number
  visible?: boolean
  x1: number
  x2: number
  z1: number
  z2: number
  is_common?: boolean
  sandbox?: boolean
  settings?: any
  owner?: any
  parcel_users?: any
  name?: string | null
  address?: string | null
  suburb?: string
  geometry?: any
  label?: string | null
}

export class Island {
  public readonly center: BABYLON.Vector3
  public readonly radius: number
  private readonly _mesh: BABYLON.Mesh

  constructor(
    private scene: BABYLON.Scene,
    private parent: BABYLON.TransformNode,
    private desc: any,
  ) {
    const shape = this.desc.geometry.coordinates[0].map((c: any) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
    const pt = new BABYLON.PolygonMeshBuilder('island/' + this.desc.name, shape, this.scene)
    const makeHoles = (multipolygon: any) => {
      const nudge = 0.25
      return multipolygon.coordinates.map((p: any) => p[0].map((c: any) => new BABYLON.Vector2(c[0] * 100 + nudge, c[1] * 100 + nudge)))
    }
    let holes = makeHoles(this.desc.lakes_geometry_json)
    if (this.desc.holes_geometry_json && this.hasBasements()) {
      holes = holes.concat(makeHoles(this.desc.holes_geometry_json))
    }
    holes.forEach((hole: BABYLON.Vector2[]) => pt.addHole(hole))

    const meshes = [pt.build(false, 0.05)]

    if (this.desc.id >= 40) {
      for (const s of this.desc.geometry.coordinates.slice(1)) {
        const shape = s.map((c: any) => new BABYLON.Vector2(c[0] * 100, c[1] * 100)).reverse()
        const pt = new BABYLON.PolygonMeshBuilder('island/' + this.desc.name, shape, this.scene)
        meshes.push(pt.build(false, 0.05))
      }
    }

    this._mesh = BABYLON.Mesh.MergeMeshes(meshes, true)!
    this._mesh.position.y = 0.75 - 0.01
    this._mesh.isEnabled(false)
    speedOptimize(this._mesh)

    this.center = this._mesh.getBoundingInfo().boundingSphere.centerWorld.clone()
    this.radius = this._mesh.getBoundingInfo().boundingSphere.radiusWorld
  }

  setMaterial(material: BABYLON.Material) {
    this._mesh.material = material
  }

  dispose() {
    this._mesh?.dispose(false, true)
  }

  distanceEnable(playerPos: BABYLON.Vector3, loadingDistance: number) {
    const pos = playerPos.clone()
    pos.y = 0
    const a = this.radius + loadingDistance
    const isVisible = pos.subtract(this.center).lengthSquared() < a * a
    if (this._mesh.isEnabled() !== isVisible) {
      this._mesh.setEnabled(isVisible)
    }
  }

  setEnabled(on: boolean) {
    this._mesh.setEnabled(on)
  }

  private hasBasements() {
    return ['Scarcity', 'Flora', 'Andromeda'].includes(this.desc.name)
  }
}

export class MapParcel {
  readonly sandbox: boolean
  readonly isCommons: boolean
  private readonly data: ParcelData
  private readonly mother: BABYLON.Mesh
  private _mesh?: BABYLON.InstancedMesh

  constructor(
    protected scene: BABYLON.Scene,
    data: ParcelData,
    mother: BABYLON.Mesh,
  ) {
    this.data = data
    this.mother = mother
    this.sandbox = data.sandbox ?? false
    this.isCommons = data.is_common ?? false
    this.setMesh(mother)
  }

  get id() {
    return this.data.id
  }

  getMesh = (): BABYLON.InstancedMesh | undefined => this._mesh

  setMesh = (mother: BABYLON.Mesh) => {
    this.dispose()
    if (!mother) return
    const nudge = 0.25
    const border = 0.5
    const width = this.data.x2 - this.data.x1 - border
    const depth = this.data.z2 - this.data.z1 - border
    this._mesh = mother.createInstance(`parcel-${this.data.id}`)
    this._mesh.scaling.x = width
    this._mesh.scaling.y = depth
    this._mesh.position.set(nudge + this.data.x1 + width / 2 - border / 2, 1.0, nudge + this.data.z1 + depth / 2 - border / 2)
    speedOptimize(this._mesh)
  }

  dispose() {
    this._mesh?.dispose(false, false)
    this._mesh = undefined
  }
}

export function speedOptimize(mesh: BABYLON.Mesh | BABYLON.InstancedMesh) {
  mesh.alwaysSelectAsActiveMesh = true
  mesh.doNotSyncBoundingInfo = true
  if ('convertToUnIndexedMesh' in mesh) {
    mesh.convertToUnIndexedMesh()
  }
  mesh.freezeWorldMatrix()
}

export function distanceEnable(mesh: BABYLON.AbstractMesh | undefined, playerMesh: BABYLON.Mesh, maxLength: number) {
  if (!mesh) return
  const dist = BABYLON.Vector3.DistanceSquared(mesh.position, playerMesh.position)
  const isVisible = dist < maxLength * maxLength
  if (isVisible !== mesh.isEnabled()) {
    mesh.setEnabled(isVisible)
  }
}

export function createBaseMeshes(scene: BABYLON.Scene) {
  return {
    parcel: createPMesh('parcel-default', scene, 0.4, 0.4, 0.4),
    sandbox: createPMesh('parcel-sandbox', scene, 0.91, 0.78, 0.18),
    common: createPMesh('parcel-common', scene, 0.1, 0.62, 0.05),
    owner: createPMesh('parcel-owner', scene, 0.98, 0.36, 0.14),
    contributor: createPMesh('parcel-contributor', scene, 0.47, 0.93, 0.83),
    listed: createPMesh('parcel-listed', scene, 0.98, 0.36, 0.14),
  }
}

export const createMaterial = (name: string, scene: BABYLON.Scene, r: number, g: number, b: number) => {
  const material = new BABYLON.StandardMaterial(name, scene)
  material.disableLighting = true
  material.emissiveColor = new BABYLON.Color3(r, g, b)
  material.freeze()
  return material
}

const createPMesh = (name: string, scene: BABYLON.Scene, r: number, g: number, b: number) => {
  const pMesh = BABYLON.MeshBuilder.CreatePlane(name, { width: 1.0, height: 1.0 }, scene)
  pMesh.position.y = 1.0
  pMesh.rotation.x = Math.PI / 2.0
  pMesh.visibility = 1
  pMesh.material = createMaterial(name, scene, r, g, b)
  pMesh.position.y = -200000000
  return pMesh
}

let islandCache: any

export async function fetchIslands() {
  if (islandCache) return islandCache
  const response = await fetch(`${process.env.ASSET_PATH || ''}/api/islands.json`)
  islandCache = await response.json()
  return islandCache
}

export async function loadIslands(scene: BABYLON.Scene, parent?: BABYLON.TransformNode, cull = false, bright = false) {
  const root = parent ?? new BABYLON.TransformNode('map_islands', scene)
  const islandMaterial = new BABYLON.StandardMaterial('map-island', scene)
  islandMaterial.disableLighting = true
  const g = bright ? 0.9 : 0.2
  islandMaterial.emissiveColor.set(g, g, g)
  if (bright) islandMaterial.backFaceCulling = false
  islandMaterial.freeze()
  const content = await fetchIslands()
  const islands = content.islands.map((desc: any) => new Island(scene, root, desc))
  islands.forEach((i: Island) => {
    i.setMaterial(islandMaterial)
    if (!cull) i.setEnabled(true)
  })
  return islands as Island[]
}

export const fetchAllParcels = (cachebust = false): Promise<ParcelRecord[]> => fetchCachedParcels(`/api/parcels/cached.json`, cachebust)
export const fetchOwnerParcels = (wallet: string, cachebust = false): Promise<ParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/parcels.json`, cachebust)
export const fetchContributingParcels = (wallet: string, cachebust = false): Promise<ParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/contributing-parcels.json`, cachebust)

export async function fetchMapParcels() {
  const r = await fetch(`${process.env.API || '/api'}/parcels/map.json`, { credentials: 'include' }).then((res) => res.json())
  return (r.parcels || []) as ParcelData[]
}

const parcelCache: Record<string, ParcelRecord[]> = {}
const fetchCachedParcels = (url: string, cachebust = false): Promise<ParcelRecord[]> => {
  return new Promise((resolve) => {
    if (!cachebust && Array.isArray(parcelCache[url])) return resolve(parcelCache[url])
    if (cachebust) url += `cb=${Date.now()}`
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        parcelCache[url] = data.parcels
        resolve(parcelCache[url])
      })
  })
}

export function pickParcelMesh(data: ParcelData, meshes: ReturnType<typeof createBaseMeshes>, wallet?: string) {
  if (data.is_common) return meshes.common
  if (data.sandbox) return meshes.sandbox
  if (wallet) {
    const help = getParcelHelper(data as any)
    if (help.isOwner(wallet)) return meshes.owner
    if (help.isContributor(wallet)) return meshes.contributor
  }
  return meshes.parcel
}

const PAGE_ORTHO = 2000
const SIDEBAR_ORTHO = 200

export type MapMarkerOpts = {
  x: number
  z: number
  html?: string
  className?: string
  title?: string
  onClick?: (e: MouseEvent) => void
}

export type MapMarker = {
  el: HTMLDivElement
  x: number
  z: number
  setPos: (x: number, z: number) => void
  setRotation: (deg: number) => void
  setClass: (name: string) => void
  remove: () => void
}

export type VoxelsMapOpts = {
  ortho?: number
  // lock camera to this scene's active camera (island info sidebar)
  follow?: BABYLON.Scene
  // show a player arrow tracking this scene without locking pan
  arrow?: BABYLON.Scene
  parcels?: boolean
  nav?: boolean
  wallet?: string
  onClick?: (x: number, z: number) => void
  onMove?: () => void
}

// babylon top-down map — shop page (wide) or island info sidebar (follow + parcels)
export class VoxelsMap {
  private engine: BABYLON.Engine
  private scene: BABYLON.Scene
  private camera: BABYLON.FreeCamera
  private islands: Island[] = []
  private parcels: MapParcel[] = []
  private rows: ParcelData[] = []
  private meshes?: ReturnType<typeof createBaseMeshes>
  private playerMesh?: BABYLON.Mesh
  private followObs?: BABYLON.Observer<BABYLON.Scene>
  private overlayObs?: BABYLON.Observer<BABYLON.Scene>
  private ro?: ResizeObserver
  private dragging = false
  private moved = false
  private lastX = 0
  private lastZ = 0
  private ortho: number
  private follow?: BABYLON.Scene
  private arrow?: BABYLON.Scene
  private wantParcels: boolean
  private wallet?: string
  private overlay: HTMLDivElement
  private markers = new Set<MapMarker>()
  private popup: HTMLDivElement | null = null
  private popupX = 0
  private popupZ = 0
  private onClick?: (x: number, z: number) => void
  private onMove?: () => void
  private homeX = 0
  private homeZ = 0
  private homeOrtho: number
  private flying = false
  private flyTarget: { x: number; z: number; ortho?: number } | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    opts: VoxelsMapOpts = {},
  ) {
    this.ortho = opts.ortho ?? PAGE_ORTHO
    this.homeOrtho = this.ortho
    this.follow = opts.follow
    this.arrow = opts.arrow ?? opts.follow
    this.wantParcels = !!opts.parcels
    this.wallet = opts.wallet
    this.onClick = opts.onClick
    this.onMove = opts.onMove

    const parent = canvas.parentElement
    if (parent) {
      const style = getComputedStyle(parent)
      if (style.position === 'static') parent.style.position = 'relative'
    }

    this.overlay = document.createElement('div')
    this.overlay.className = 'voxels-map-overlay'
    this.overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2'
    canvas.insertAdjacentElement('afterend', this.overlay)

    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    this.scene = new BABYLON.Scene(this.engine)
    this.scene.clearColor = OCEAN
    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true

    this.camera = new BABYLON.FreeCamera('voxels_map_cam', new BABYLON.Vector3(0, 100, 0), this.scene)
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
    this.camera.setTarget(BABYLON.Vector3.Zero())
    // setTarget straight down resolves yaw to PI, rendering the world 180deg
    // rotated (south-up). force yaw 0 so north is up, same as the minimap.
    this.camera.rotation.y = 0
    this.camera.position.x = 0
    this.camera.position.z = 0
    this.scene.activeCamera = this.camera

    if (this.arrow) {
      this.playerMesh = this.createTriangleMesh('map_player')
      this.playerMesh.material = createMaterial('map_player', this.scene, 1, 1, 1)
      this.playerMesh.alwaysSelectAsActiveMesh = true
      this.playerMesh.scaling.set(1.75, 1.75, 2.5)
      this.followObs = this.arrow.onAfterRenderObservable.add(() => this.syncArrow())
    }

    this.engine.resize()
    this.setOrtho(this.ortho)

    this.engine.runRenderLoop(() => this.scene.render())
    this.ro = new ResizeObserver(() => {
      this.engine.resize()
      this.setOrtho(this.ortho)
    })
    this.ro.observe(canvas as unknown as Element)
    this.bindPanZoom()
    this.overlayObs = this.scene.onAfterRenderObservable.add(() => this.syncOverlay())

    if (opts.nav) this.addNav()
  }

  async load() {
    this.islands = await loadIslands(this.scene, undefined, false, true)
    if (this.wantParcels) await this.loadParcels()
    this.syncArrow()
  }

  dispose() {
    this.stopFly()
    if (this.arrow && this.followObs) {
      this.arrow.onAfterRenderObservable.remove(this.followObs)
      this.followObs = undefined
    }
    if (this.overlayObs) {
      this.scene.onAfterRenderObservable.remove(this.overlayObs)
      this.overlayObs = undefined
    }
    this.ro?.disconnect()
    this.engine.stopRenderLoop()
    this.closePopup()
    for (const m of [...this.markers]) m.remove()
    this.overlay.remove()
    this.parcels.forEach((p) => p.dispose())
    this.parcels = []
    this.islands.forEach((i) => i.dispose())
    this.scene.dispose()
    this.engine.dispose()
  }

  setWallet(wallet?: string) {
    this.wallet = wallet
    if (!this.meshes || !this.rows.length) return
    this.parcels.forEach((p) => p.dispose())
    this.parcels = this.rows.filter((p) => p.visible !== false).map((p) => new MapParcel(this.scene, p, pickParcelMesh(p, this.meshes!, this.wallet)))
  }

  getParcels() {
    return this.rows
  }

  parcelAt(x: number, z: number): ParcelData | undefined {
    for (const p of this.rows) {
      if (p.visible === false) continue
      if (x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2) return p
    }
  }

  setView(x: number, z: number, ortho?: number) {
    this.stopFly()
    this.camera.position.x = x
    this.camera.position.z = z
    if (ortho != null) this.setOrtho(ortho)
    this.onMove?.()
  }

  flyTo(x: number, z: number, ortho?: number, ms = 700) {
    if (this.flyTarget && this.flyTarget.x === x && this.flyTarget.z === z && this.flyTarget.ortho === ortho) return
    this.stopFly()
    const fps = 60
    const frames = Math.max(1, Math.round((ms / 1000) * fps))

    const ease = new BABYLON.QuadraticEase()
    ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT)

    const to = new BABYLON.Vector3(x, this.camera.position.y, z)
    this.flying = true
    this.flyTarget = { x, z, ortho }
    BABYLON.Animation.CreateAndStartAnimation('map-fly', this.camera, 'position', fps, frames, this.camera.position.clone(), to, 0, ease, () => {
      this.flying = false
      this.flyTarget = null
      this.onMove?.()
    })
    if (ortho != null) {
      BABYLON.Animation.CreateAndStartAnimation('map-zoom', this, 'flyOrtho', fps, frames, this.ortho, ortho, 0, ease, undefined, this.scene)
    }
  }

  fitBounds(x1: number, z1: number, x2: number, z2: number, pad = 1.2) {
    const w = Math.abs(x2 - x1) || 1
    const d = Math.abs(z2 - z1) || 1
    const aspect = this.aspect()
    const size = Math.max(d, w / aspect) * pad
    this.setView((x1 + x2) / 2, (z1 + z2) / 2, Math.max(80, Math.min(10000, size)))
  }

  getBounds() {
    const aspect = this.aspect()
    const halfH = this.ortho / 2
    const halfW = halfH * aspect
    const x = this.camera.position.x
    const z = this.camera.position.z
    return { x1: x - halfW, z1: z - halfH, x2: x + halfW, z2: z + halfH }
  }

  worldToScreen(x: number, z: number) {
    const aspect = this.aspect()
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const halfH = this.ortho / 2
    const halfW = halfH * aspect
    const px = ((x - this.camera.position.x) / (halfW * 2)) * w + w / 2
    const py = ((this.camera.position.z - z) / (halfH * 2)) * h + h / 2
    return { px, py }
  }

  screenToWorld(px: number, py: number) {
    const rect = this.canvas.getBoundingClientRect()
    const lx = px - rect.left
    const ly = py - rect.top
    const aspect = this.aspect()
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const halfH = this.ortho / 2
    const halfW = halfH * aspect
    return {
      x: this.camera.position.x + (lx / w - 0.5) * halfW * 2,
      z: this.camera.position.z - (ly / h - 0.5) * halfH * 2,
    }
  }

  addMarker(opts: MapMarkerOpts): MapMarker {
    const el = document.createElement('div')
    el.className = opts.className || 'voxels-map-marker'
    el.style.cssText = 'position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer'
    if (opts.html) el.innerHTML = opts.html
    if (opts.title) el.title = opts.title
    if (opts.onClick)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        opts.onClick!(e)
      })
    this.overlay.appendChild(el)

    const marker: MapMarker = {
      el,
      x: opts.x,
      z: opts.z,
      setPos: (x, z) => {
        marker.x = x
        marker.z = z
      },
      setRotation: (deg) => {
        el.style.transform = `translate(-50%,-50%) rotate(${deg}deg)`
      },
      setClass: (name) => {
        el.className = name
      },
      remove: () => {
        el.remove()
        this.markers.delete(marker)
      },
    }
    this.markers.add(marker)
    return marker
  }

  openPopup(x: number, z: number, el: HTMLElement) {
    this.closePopup()
    const wrap = document.createElement('div')
    wrap.className = 'voxels-map-popup'
    wrap.style.cssText = 'position:absolute;transform:translate(-50%,-100%);pointer-events:auto;z-index:5;margin-top:-8px'
    wrap.appendChild(el)
    wrap.addEventListener('click', (e) => e.stopPropagation())
    this.overlay.appendChild(wrap)
    this.popup = wrap
    this.popupX = x
    this.popupZ = z
  }

  closePopup() {
    this.popup?.remove()
    this.popup = null
  }

  private syncOverlay() {
    for (const m of this.markers) {
      const { px, py } = this.worldToScreen(m.x, m.z)
      m.el.style.left = `${px}px`
      m.el.style.top = `${py}px`
    }
    if (this.popup) {
      const { px, py } = this.worldToScreen(this.popupX, this.popupZ)
      this.popup.style.left = `${px}px`
      this.popup.style.top = `${py}px`
    }
  }

  private addNav() {
    const box = document.createElement('div')
    box.className = 'voxels-map-nav'
    box.style.cssText = 'position:absolute;top:1rem;right:1rem;display:flex;flex-direction:column;gap:0.25rem;pointer-events:auto;z-index:4'
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.onclick = (e) => {
        e.stopPropagation()
        fn()
      }
      box.appendChild(b)
    }
    mk('+', () => this.setOrtho(Math.max(80, this.ortho * 0.9)))
    mk('-', () => this.setOrtho(Math.min(10000, this.ortho * 1.1)))
    mk('⌂', () => this.setView(this.homeX, this.homeZ, this.homeOrtho))
    this.overlay.appendChild(box)
  }

  private syncArrow() {
    const src = this.arrow
    if (!src?.activeCamera) return
    const cam = src.activeCamera
    if (this.follow) {
      this.camera.position.x = cam.position.x
      this.camera.position.z = cam.position.z
    }
    if (this.playerMesh) {
      this.playerMesh.position.copyFrom(cam.position)
      this.playerMesh.position.y = 2
      if (cam instanceof BABYLON.TargetCamera) {
        this.playerMesh.rotation.y = cam.rotation.y
      }
    }
  }

  private async loadParcels() {
    this.meshes = createBaseMeshes(this.scene)
    const rows = await fetchMapParcels()
    this.rows = rows
    this.parcels = rows.filter((p) => p.visible !== false).map((p) => new MapParcel(this.scene, p, pickParcelMesh(p, this.meshes!, this.wallet)))
  }

  private createTriangleMesh(name: string) {
    const vertexData = new BABYLON.VertexData()
    vertexData.positions = [-0, 1, 1, -1, 1, -1, 1, 1, -1]
    vertexData.indices = [0, 1, 2]
    const m = new BABYLON.Mesh(name, this.scene)
    vertexData.applyToMesh(m)
    m.convertToUnIndexedMesh()
    return m
  }

  private aspect() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    return w / h
  }

  private get flyOrtho() {
    return this.ortho
  }

  private set flyOrtho(v: number) {
    this.setOrtho(v)
  }

  private stopFly() {
    if (!this.flying) return
    this.scene.stopAnimation(this.camera)
    this.scene.stopAnimation(this)
    this.flying = false
    this.flyTarget = null
  }

  private setOrtho(size: number) {
    this.ortho = size
    const aspect = this.aspect()
    this.camera.orthoTop = size / 2
    this.camera.orthoBottom = -size / 2
    this.camera.orthoRight = (size / 2) * aspect
    this.camera.orthoLeft = -(size / 2) * aspect
    if (!this.flying) this.onMove?.()
  }

  private bindPanZoom() {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.stopFly()
        const f = e.deltaY > 0 ? 1.1 : 0.9
        this.setOrtho(Math.max(80, Math.min(10000, this.ortho * f)))
      },
      { passive: false },
    )

    // follow mode sticks to the player — pan would just fight it
    if (this.follow) return

    this.canvas.addEventListener('pointerdown', (e) => {
      this.stopFly()
      this.dragging = true
      this.moved = false
      this.lastX = e.clientX
      this.lastZ = e.clientY
      this.canvas.setPointerCapture(e.pointerId)
    })

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastX
      const dz = e.clientY - this.lastZ
      if (Math.abs(dx) + Math.abs(dz) > 3) this.moved = true
      const aspect = this.aspect()
      const scale = this.ortho / (this.canvas.clientHeight || 1)
      this.camera.position.x -= (dx * scale) / aspect
      this.camera.position.z += dz * scale
      this.lastX = e.clientX
      this.lastZ = e.clientY
      this.onMove?.()
    })

    const up = (e: PointerEvent) => {
      if (this.dragging && !this.moved) {
        const { x, z } = this.screenToWorld(e.clientX, e.clientY)
        this.closePopup()
        this.onClick?.(x, z)
      }
      this.dragging = false
      try {
        this.canvas.releasePointerCapture(e.pointerId)
      } catch {}
    }
    this.canvas.addEventListener('pointerup', up)
    this.canvas.addEventListener('pointercancel', up)
  }
}

export { PAGE_ORTHO, SIDEBAR_ORTHO }
