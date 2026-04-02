import type Connector from './connector'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { isMobile } from '../common/helpers/detector'
import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import { SingleParcelRecord } from '../common/messages/parcel'
import { app, AppEvent } from '../web/src/state'
import { fetchAPI } from '../web/src/utils'
// Create a retry policy that'll try whatever function with a randomized exponential backoff.
// to be used by fetch!
const retryPolicy = retry(handleAll, { backoff: new ExponentialBackoff(), maxAttempts: 5 })

// the map will be sized to be this width of the whole browser window
const MAP_SCREEN_SIZE = 0.15

export class Minimap {
  private readonly settings: MinimapSettings

  private readonly engine: BABYLON.Engine
  private readonly scene: BABYLON.Scene
  private readonly camera: BABYLON.FreeCamera
  private islands: Island[] = []
  private parcels: Parcel[] = []

  private readonly playerMesh: BABYLON.Mesh
  private readonly connector: Connector
  private otherPlayerMesh: BABYLON.Mesh
  private otherPlayers = new Map<string, BABYLON.AbstractMesh>()
  private onBeforeRender: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> | undefined

  private meshes: { parcel: BABYLON.Mesh; sandbox: BABYLON.Mesh; common: BABYLON.Mesh; owner: BABYLON.Mesh; contributor: BABYLON.Mesh }
  private islandContent: any

  constructor(engine: BABYLON.Engine, connector: Connector) {
    this.engine = engine
    this.connector = connector
    this.scene = new BABYLON.Scene(engine)
    this.scene.performancePriority = BABYLON.ScenePerformancePriority.BackwardCompatible
    this.scene.collisionsEnabled = false

    // disable picking, we don't need it unless we add teleport here support later
    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true

    this.settings = new MinimapSettings()
    // will act as fake ocean
    this.scene.clearColor = new BABYLON.Color4(0.19, 0.44, 0.54)
    this.scene.autoClear = false

    this.camera = new BABYLON.FreeCamera('map_camera', new BABYLON.Vector3(0, 100, 0), this.scene)
    this.camera.setTarget(new BABYLON.Vector3(0.0, 0.0, 0.0))
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA

    this.camera.viewport = new BABYLON.Viewport(0.9, 0.9, 0.1, 0.1)
    this.syncAspectRatio()

    const ppp = new BABYLON.PassPostProcess('pass', 1, this.camera)
    ppp.samples = engine.getCaps().maxMSAASamples

    this.playerMesh = this.createTriangleMesh('map_player')
    this.playerMesh.material = createMaterial('map_player', this.scene, 1, 1, 1)
    this.playerMesh.alwaysSelectAsActiveMesh = true

    // create the first mesh to which all other meshes are instanced from
    this.otherPlayerMesh = this.createTriangleMesh(`map_other_player`)
    this.otherPlayerMesh.material = createMaterial('map_other_player', this.scene, 0.95, 0.86, 0.7)
    const scale = this.settings.zoomed ? 3.0 : 1.5
    this.otherPlayerMesh.scaling.setAll(scale)
    // we cant hide this mesh, but we can put it so far away it's never visible
    this.otherPlayerMesh.position.y = -2000000
    this.otherPlayerMesh.freezeWorldMatrix()

    this.meshes = createBaseMeshes(this.scene)

    app.on(AppEvent.Login, this.onAppChange.bind(this))
    app.on(AppEvent.Logout, this.onAppChange.bind(this))
  }

  protected get size() {
    return this.settings.zoomed ? 200 : 100
  }

  public setMapZoomLevel() {
    if (!this.settings.zoomed) {
      this.playerMesh.scaling.set(1.75, 1.75, 2.5)
      this.otherPlayerMesh.scaling.set(1.0, 1.0, 1.0)
    } else {
      this.playerMesh.scaling.set(3.5, 3.5, 5)
      this.otherPlayerMesh.scaling.set(2.0, 2.0, 2.0)
    }

    this.camera.orthoRight = this.size / 2
    this.camera.orthoLeft = -this.size / 2
    this.camera.orthoTop = this.size / 2
    this.camera.orthoBottom = -this.size / 2
  }

  isClickWithinViewport(event: BABYLON.IMouseEvent) {
    // Get the canvas dimensions
    // Get the canvas and its bounding rectangle
    const canvas = this.scene.getEngine().getRenderingCanvas()
    if (!canvas) return false
    const rect = canvas.getBoundingClientRect()

    // Adjust the mouse coordinates relative to the canvas
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    // Get the canvas dimensions
    const canvasWidth = canvas.clientWidth
    const canvasHeight = canvas.clientHeight

    // Normalize mouse coordinates
    const normalizedMouseX = mouseX / canvasWidth
    const normalizedMouseY = 1 - mouseY / canvasHeight

    // Get the camera viewport
    const viewport = this.camera.viewport

    // Check if normalized mouse coordinates are within the viewport
    return normalizedMouseX >= viewport.x && normalizedMouseY >= viewport.y && normalizedMouseX < viewport.x + viewport.width && normalizedMouseY < viewport.y + viewport.height
  }

  onAppChange() {
    this.unloadParcels()
    this.loadParcels()
  }

  public start(playerScene: BABYLON.Scene) {
    this.stop()
    this.setMapZoomLevel()

    this.loadIslandsAndParcels()

    this.onBeforeRender = playerScene.onAfterRenderObservable.add(() => {
      if (playerScene.activeCamera instanceof BABYLON.TargetCamera) {
        const activePlayerCamera = playerScene.activeCamera
        this.playerMesh.position.copyFrom(activePlayerCamera.position)
        this.camera.position.x = activePlayerCamera.position.x
        this.camera.position.z = activePlayerCamera.position.z

        this.playerMesh.rotation.y = activePlayerCamera.rotation.y
        if (this.settings.rotate) {
          this.camera.rotation.y = activePlayerCamera.rotation.y
        } else {
          this.camera.rotation.y = 0
        }
      }

      const online: string[] = []
      this.connector.avatarsByUuid.forEach((avatar, uuid) => {
        if (!avatar.hasPosition) return // avoid showing incomplete avatars at 0,0,0
        online.push(uuid)
        let m = this.otherPlayers.get(uuid)
        if (!m) {
          m = this.otherPlayerMesh.createInstance(`p-${uuid}`)
          m.alwaysSelectAsActiveMesh = true
          m.doNotSyncBoundingInfo = true
          m.freezeWorldMatrix()
          this.otherPlayers.set(uuid, m)
        }
        const dist = BABYLON.Vector3.DistanceSquared(m.position, avatar.position)
        const rot = BABYLON.Vector3.DistanceSquared(m.rotation, avatar.orientation)
        if (dist > 0.2 || rot > 0.2) {
          m.position.copyFrom(avatar.position)
          m.rotation.y = avatar.orientation.y
          m.freezeWorldMatrix() // recalculates the worldmatrix
        }
      })

      // run these maintenance tasks only once per 15 frames
      if (this.scene.getRenderId() % 15 === 0) {
        this.removeOfflinePlayers(online)
        this.syncAspectRatio()
        // 1.41421 (sqrt(2)) is the length of the hypotenuse of an isosceles right triangle, i.e. the distance to the
        // corner from the center of the map, i.e. the max distance we can see in the minimap plus a bit of a buffer
        const mapRadius = this.size * 1.41421 + 10
        this.islands.forEach((i) => i.distanceEnable(this.playerMesh.position, mapRadius))
        this.otherPlayers.forEach((mesh) => distanceEnable(mesh, this.playerMesh, mapRadius))
        this.parcels.forEach((p) => distanceEnable(p.getMesh(), this.playerMesh, mapRadius))
      }
    })
    return this.scene
  }

  public stop() {
    if (this.onBeforeRender) {
      this.scene.onAfterRenderObservable.remove(this.onBeforeRender)
    }
    this.unloadIslandsAndParcels()
    this.unloadOtherPlayers()
  }

  getMesh(data: SingleParcelRecord) {
    if (data.is_common) return this.meshes.common
    if (data.settings?.sandbox) return this.meshes.sandbox
    return this.meshes.parcel
  }

  getSettings() {
    return this.settings
  }

  private async loadIslandsAndParcels() {
    Promise.all([this.loadIslands(), this.loadParcels()])
  }

  private unloadIslandsAndParcels() {
    this.unloadParcels()
    this.unloadIslands()
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

  private async loadIslands() {
    const rootNode = new BABYLON.TransformNode('map_islands', this.scene)
    const islandMaterial = new BABYLON.StandardMaterial('map-island', this.scene)
    islandMaterial.disableLighting = true
    islandMaterial.emissiveColor.set(0.2, 0.2, 0.2)
    islandMaterial.freeze()
    if (!this.islandContent) {
      const response = await retryPolicy.execute(() => fetch(`${process.env.ASSET_PATH}/api/islands.json`))
      this.islandContent = await response.json()
    }
    this.islands = this.islandContent.islands.map((desc: any) => new Island(this.scene, rootNode, desc))
    this.islands.forEach((i) => i.setMaterial(islandMaterial))
  }

  private unloadIslands() {
    this.islands.forEach((island) => island.dispose())
    this.islands = []
  }

  private async loadParcels() {
    this.parcels = []
    return fetchAllParcels().then((parcels) => {
      this.parcels = parcels?.filter((p) => p.visible).map((p) => new Parcel(this.scene, p, this.getMesh(p)))
      return this.loadWalletParcels()
    })
  }

  private async loadWalletParcels() {
    if (!app.state.wallet) return
    const o = fetchOwnerParcels(app.state.wallet).then((parcels) => {
      parcels.forEach((owned) => {
        const e = this.parcels.find((p) => p.id === owned.id)
        if (!e) return console.error(`owned parcel #${owned.id} not found`)
        e.setMesh(this.meshes.owner)
      })
    })
    const c = fetchContributingParcels(app.state.wallet).then((parcels) => {
      parcels.forEach((contributor) => {
        const e = this.parcels.find((p) => p.id === contributor.id)
        if (!e) return console.error(`contributor parcel #${contributor.id} not found`)
        e.setMesh(this.meshes.contributor)
      })
    })

    await Promise.all([o, c])
  }

  private unloadParcels() {
    this.parcels.forEach((parcel) => parcel.dispose())
    this.parcels = []
  }

  /**
   * brute force removal of all other player meshes that aren't online
   */
  private removeOfflinePlayers(online: string[]) {
    this.otherPlayers.forEach((mesh, uuid) => {
      if (!online.includes(uuid)) {
        mesh.dispose()
        this.otherPlayers.delete(uuid)
      }
    })
  }

  /**
   * since the camera is using a special viewport to render the map above the main scene
   * we need to update it if the aspect ratio of the screen changes because the viewport
   * is set in Screen-Space, i.e. 0.0 - 1.0
   */
  private syncAspectRatio() {
    const engine = this.scene.getEngine()
    const pxWidth = engine.getRenderingCanvas()?.width
    const pxHeight = engine.getRenderingCanvas()?.height
    if (!pxWidth || !pxHeight) return
    const pxPadding = 0
    const width = MAP_SCREEN_SIZE
    const height = (pxWidth * width) / pxHeight
    this.camera.viewport.x = (pxWidth - pxPadding) / pxWidth - width
    this.camera.viewport.width = width
    this.camera.viewport.y = pxPadding / pxHeight
    this.camera.viewport.height = height
  }

  private unloadOtherPlayers() {
    this.otherPlayers.forEach((mesh) => mesh.dispose())
    this.otherPlayers.clear()
  }
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

    // Handle multi-ring islands (islands with id >= 40 can have multiple geometry rings)
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

  private hasBasements() {
    return ['Scarcity', 'Flora', 'Andromeda'].includes(this.desc.name)
  }
}

interface ParcelData {
  id: number
  visible: boolean
  x1: number
  x2: number
  z1: number
  z2: number
  is_common?: boolean
  settings?: { sandbox?: boolean }
}

class Parcel {
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

export class MinimapSettings extends TypedEventTarget<{ changed: { enabled: boolean; zoomed: boolean; hide: boolean } }> {
  constructor() {
    super()
    const settings = this.getSavedSettings()
    if ('enabled' in settings) {
      this._enabled = !!settings.enabled
    }
    if ('zoomed' in settings) {
      this._zoomed = !!settings.zoomed
    }
    if ('rotate' in settings) {
      this._rotate = !!settings.rotate
    }
  }

  private _enabled = true

  public get enabled() {
    if (isMobile()) return false
    return this._enabled
  }

  public set enabled(value: boolean) {
    if (isMobile()) return
    this._enabled = value
    this.saveSettings(this.json)
    this.dispatchEvent(createEvent('changed', this.json))
  }

  private _zoomed = false

  public get zoomed(): boolean {
    return this._zoomed
  }

  public set zoomed(value: boolean) {
    this._zoomed = value
    this.saveSettings(this.json)
    this.dispatchEvent(createEvent('changed', this.json))
  }

  // not stored as a user preference
  private _hide = false

  get hide(): boolean {
    return this._hide
  }

  set hide(value: boolean) {
    this._hide = value
    this.dispatchEvent(createEvent('changed', this.json))
  }

  private _rotate = false

  get rotate(): boolean {
    return this._rotate
  }

  set rotate(value: boolean) {
    this._rotate = value
    this.saveSettings(this.json)
    this.dispatchEvent(createEvent('changed', this.json))
  }

  private get json() {
    return {
      enabled: this._enabled,
      zoomed: this._zoomed,
      hide: this._hide,
      rotate: this._rotate,
    }
  }

  private getSavedSettings() {
    if (typeof localStorage === 'undefined') return null
    const stored = localStorage.getItem('minimap') || '{}'
    if (!stored) return null
    const settings = JSON.parse(stored)
    if (!settings) return null
    return settings
  }

  private saveSettings(settings: any) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem('minimap', JSON.stringify(settings))
  }
}

function speedOptimize(mesh: BABYLON.Mesh | BABYLON.InstancedMesh) {
  mesh.alwaysSelectAsActiveMesh = true
  mesh.doNotSyncBoundingInfo = true
  if ('convertToUnIndexedMesh' in mesh) {
    mesh.convertToUnIndexedMesh()
  }
  mesh.freezeWorldMatrix()
}

function distanceEnable(mesh: BABYLON.AbstractMesh | undefined, playerMesh: BABYLON.Mesh, maxLength: number) {
  if (!mesh) return
  const dist = BABYLON.Vector3.DistanceSquared(mesh.position, playerMesh.position)
  const isVisible = dist < maxLength * maxLength
  if (isVisible !== mesh.isEnabled()) {
    mesh.setEnabled(isVisible)
  }
}

function createBaseMeshes(scene: BABYLON.Scene) {
  return {
    parcel: createPMesh('parcel-default', scene, 0.4, 0.4, 0.4),
    sandbox: createPMesh('parcel-sandbox', scene, 0.91, 0.78, 0.18),
    common: createPMesh('parcel-common', scene, 0.1, 0.62, 0.05),
    owner: createPMesh('parcel-owner', scene, 0.98, 0.36, 0.14),
    contributor: createPMesh('parcel-contributor', scene, 0.47, 0.93, 0.83),
  }
}

const createMaterial = (name: string, scene: BABYLON.Scene, r: number, g: number, b: number) => {
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

const fetchAllParcels = (cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/parcels/cached.json`, cachebust)
const fetchOwnerParcels = (wallet: string, cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/parcels.json`, cachebust)
const fetchContributingParcels = (wallet: string, cachebust = false): Promise<SingleParcelRecord[]> => fetchCachedParcels(`/api/wallet/${wallet}/contributing-parcels.json`, cachebust)

const parcelCache: Record<string, SingleParcelRecord[]> = {}
const fetchCachedParcels = (url: string, cachebust = false): Promise<SingleParcelRecord[]> => {
  return new Promise((resolve) => {
    if (!cachebust && Array.isArray(parcelCache[url])) return resolve(parcelCache[url])
    if (cachebust) url += `cb=${Date.now()}`
    retryPolicy
      .execute(() => fetchAPI(url))
      .then((data) => {
        parcelCache[url] = data.parcels
        resolve(parcelCache[url])
      })
  })
}
