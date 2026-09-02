import type Connector from './connector'
import { createEvent, TypedEventTarget } from './utils/EventEmitter'
import { isMobile } from '../common/helpers/detector'
import { ParcelRecord } from '../common/messages/parcel'
import { app, AppEvent } from '../web/src/state'
import { cameraPosition } from './utils/camera'
import { distanceEnable, fetchAllParcels, fetchContributingParcels, fetchIslands, fetchOwnerParcels, Island, MapParcel, OCEAN, createBaseMeshes, createMaterial, pickParcelMesh } from './voxels-map'

// the map will be sized to be this width of the whole browser window
const MAP_SCREEN_SIZE = 0.15

export { Island } from './voxels-map'

export class Minimap {
  private readonly settings: MinimapSettings

  private readonly engine: BABYLON.Engine
  private readonly scene: BABYLON.Scene
  private readonly camera: BABYLON.FreeCamera
  private islands: Island[] = []
  private parcels: MapParcel[] = []

  private readonly playerMesh: BABYLON.Mesh
  private readonly connector: Connector
  private otherPlayerMesh: BABYLON.Mesh
  private otherPlayers = new Map<string, BABYLON.AbstractMesh>()
  private onBeforeRender: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> | undefined

  private meshes: ReturnType<typeof createBaseMeshes>
  private islandContent: any

  constructor(engine: BABYLON.Engine, connector: Connector) {
    this.engine = engine
    this.connector = connector
    this.scene = new BABYLON.Scene(engine)
    this.scene.performancePriority = BABYLON.ScenePerformancePriority.BackwardCompatible

    this.scene.skipPointerMovePicking = true
    this.scene.skipPointerDownPicking = true
    this.scene.skipPointerUpPicking = true

    this.settings = new MinimapSettings()
    this.scene.clearColor = OCEAN
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

    this.otherPlayerMesh = this.createTriangleMesh(`map_other_player`)
    this.otherPlayerMesh.material = createMaterial('map_other_player', this.scene, 0.95, 0.86, 0.7)
    const scale = this.settings.zoomed ? 3.0 : 1.5
    this.otherPlayerMesh.scaling.setAll(scale)
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
    const canvas = this.scene.getEngine().getRenderingCanvas()
    if (!canvas) return false
    const rect = canvas.getBoundingClientRect()

    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const canvasWidth = canvas.clientWidth
    const canvasHeight = canvas.clientHeight

    const normalizedMouseX = mouseX / canvasWidth
    const normalizedMouseY = 1 - mouseY / canvasHeight

    const viewport = this.camera.viewport

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
        const pos = cameraPosition(playerScene)
        this.playerMesh.position.copyFrom(pos)
        this.camera.position.x = pos.x
        this.camera.position.z = pos.z

        this.playerMesh.rotation.y = activePlayerCamera.rotation.y
        if (this.settings.rotate) {
          this.camera.rotation.y = activePlayerCamera.rotation.y
        } else {
          this.camera.rotation.y = 0
        }
      }

      const online: string[] = []
      this.connector.avatarsByUuid.forEach((avatar, uuid) => {
        if (!avatar.hasPosition) return
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
          m.freezeWorldMatrix()
        }
      })

      if (this.scene.getRenderId() % 15 === 0) {
        this.removeOfflinePlayers(online)
        this.syncAspectRatio()
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

  getMesh(data: ParcelRecord) {
    return pickParcelMesh(data, this.meshes)
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
      this.islandContent = await fetchIslands()
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

    const parcels = await fetchAllParcels()
    this.parcels = parcels.map((p) => new MapParcel(this.scene, p, this.getMesh(p)))
  }

  private unloadParcels() {
    this.parcels.forEach((parcel) => parcel.dispose())
    this.parcels = []
  }

  private removeOfflinePlayers(online: string[]) {
    this.otherPlayers.forEach((mesh, uuid) => {
      if (!online.includes(uuid)) {
        mesh.dispose()
        this.otherPlayers.delete(uuid)
      }
    })
  }

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

export class MinimapSettings extends TypedEventTarget<{ changed: { enabled: boolean; zoomed: boolean; hide: boolean } }> {
  constructor() {
    super()
    const settings = this.getSavedSettings() || {}
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

  private _zoomed = true

  public get zoomed(): boolean {
    return this._zoomed
  }

  public set zoomed(value: boolean) {
    this._zoomed = value
    this.saveSettings(this.json)
    this.dispatchEvent(createEvent('changed', this.json))
  }

  private _hide = false

  get hide(): boolean {
    return this._hide
  }

  set hide(value: boolean) {
    this._hide = value
    this.dispatchEvent(createEvent('changed', this.json))
  }

  private _rotate = true

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
    const stored = localStorage.getItem('minimap2') || '{}'
    if (!stored) return null
    const settings = JSON.parse(stored)
    if (!settings) return null
    return settings
  }

  private saveSettings(settings: any) {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem('minimap2', JSON.stringify(settings))
  }
}
