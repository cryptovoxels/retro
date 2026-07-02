import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import { SingleParcelRecord } from '../common/messages/parcel'

const retryPolicy = retry(handleAll, { backoff: new ExponentialBackoff(), maxAttempts: 5 })

export const OCEAN = new BABYLON.Color4(0.19, 0.44, 0.54, 1)

export interface ParcelData {
  id: number
  visible?: boolean
  x1: number
  x2: number
  z1: number
  z2: number
  is_common?: boolean
  settings?: { sandbox?: boolean }
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
    this.sandbox = data.settings?.sandbox ?? false
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
  const response = await retryPolicy.execute(() => fetch(`${process.env.ASSET_PATH || ''}/api/islands.json`))
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

export const fetchAllParcels = (cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/parcels/cached.json`, cachebust)
export const fetchOwnerParcels = (wallet: string, cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/parcels.json`, cachebust)
export const fetchContributingParcels = (wallet: string, cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/contributing-parcels.json`, cachebust)

export async function fetchMapParcels() {
  const r = await retryPolicy.execute(() => fetch(`${process.env.API || '/api'}/parcels/map.json`, { credentials: 'include' }).then((res) => res.json()))
  return (r.parcels || []) as ParcelData[]
}

const parcelCache: Record<string, SingleParcelRecord[]> = {}
const fetchCachedParcels = (url: string, cachebust = false): Promise<SingleParcelRecord[]> => {
  return new Promise((resolve) => {
    if (!cachebust && Array.isArray(parcelCache[url])) return resolve(parcelCache[url])
    if (cachebust) url += `cb=${Date.now()}`
    retryPolicy
      .execute(() => fetch(url, { credentials: 'include' }).then((r) => r.json()))
      .then((data) => {
        parcelCache[url] = data.parcels
        resolve(parcelCache[url])
      })
  })
}

export function pickParcelMesh(data: ParcelData, meshes: ReturnType<typeof createBaseMeshes>) {
  if (data.is_common) return meshes.common
  if (data.settings?.sandbox) return meshes.sandbox
  return meshes.parcel
}

const PAGE_ORTHO = 2000

// full-page babylon map (sale page and future main map)
export class VoxelsMap {
  private engine: BABYLON.Engine
  private scene: BABYLON.Scene
  private camera: BABYLON.FreeCamera
  private islands: Island[] = []
  private ro?: ResizeObserver
  private dragging = false
  private lastX = 0
  private lastZ = 0
  private ortho = PAGE_ORTHO

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    this.scene = new BABYLON.Scene(this.engine)
    this.scene.clearColor = OCEAN
    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true

    this.camera = new BABYLON.FreeCamera('voxels_map_cam', new BABYLON.Vector3(0, 100, 0), this.scene)
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA
    this.camera.setTarget(BABYLON.Vector3.Zero())
    this.camera.position.x = 0
    this.camera.position.z = 0
    this.scene.activeCamera = this.camera

    this.engine.resize()
    this.setOrtho(PAGE_ORTHO)

    this.engine.runRenderLoop(() => this.scene.render())
    this.ro = new ResizeObserver(() => {
      this.engine.resize()
      this.setOrtho(this.ortho)
    })
    this.ro.observe(canvas as unknown as Element)
    this.bindPanZoom()
  }

  async load() {
    this.islands = await loadIslands(this.scene, undefined, false, true)
  }

  dispose() {
    this.ro?.disconnect()
    this.engine.stopRenderLoop()
    this.islands.forEach((i) => i.dispose())
    this.scene.dispose()
    this.engine.dispose()
  }

  private aspect() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    return w / h
  }

  private setOrtho(size: number) {
    this.ortho = size
    const aspect = this.aspect()
    this.camera.orthoTop = size / 2
    this.camera.orthoBottom = -size / 2
    this.camera.orthoRight = (size / 2) * aspect
    this.camera.orthoLeft = -(size / 2) * aspect
  }

  private bindPanZoom() {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const f = e.deltaY > 0 ? 1.1 : 0.9
        this.setOrtho(Math.max(100, Math.min(10000, this.ortho * f)))
      },
      { passive: false },
    )

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true
      this.lastX = e.clientX
      this.lastZ = e.clientY
      this.canvas.setPointerCapture(e.pointerId)
    })

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return
      const aspect = this.aspect()
      const scale = this.ortho / (this.canvas.clientHeight || 1)
      this.camera.position.x += ((e.clientX - this.lastX) * scale) / aspect
      this.camera.position.z -= (e.clientY - this.lastZ) * scale
      this.lastX = e.clientX
      this.lastZ = e.clientY
    })

    const up = (e: PointerEvent) => {
      this.dragging = false
      try {
        this.canvas.releasePointerCapture(e.pointerId)
      } catch {}
    }
    this.canvas.addEventListener('pointerup', up)
    this.canvas.addEventListener('pointercancel', up)
  }
}
