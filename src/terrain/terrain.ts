import OceanFloor from './ocean-floor'
import Islands from './islands'
import { isLoaded } from '../utils/loading-done'
import { StateObservable } from '../utils/state-observable'
import { Ocean } from './ocean'
import { ChunkSystem } from './chunk-system'
import { Mesh, SceneContext, Vec2 } from '@babylonjs/lite'

const CHUNK_SIZE = 48

export class Terrain {
  public islandsStateObservable: StateObservable<'loaded' | 'unloaded'>
  public invalidateIslandsLoaded: () => void
  private readonly _scene: SceneContext
  private readonly _islands: Islands
  private readonly _oceanFloor: OceanFloor
  private _ocean: Ocean
  private readonly _chunkSystem: ChunkSystem
  private _islandsHasLoaded = false
  private _loadRange: number

  constructor(scene: SceneContext, skyboxes: any[]) {
    this._scene = scene
    this._loadRange = Math.ceil((window.draw.distance * 1.414 + CHUNK_SIZE / 2) / CHUNK_SIZE)

    this._islands = new Islands(scene)
    this.islandsStateObservable = this._islands.islandsStateObservable
    this.invalidateIslandsLoaded = () => this._islands.invalidateIslandsLoaded()

    this._oceanFloor = new OceanFloor(CHUNK_SIZE, scene)

    // Extract meshes from skyboxes for reflection
    const skyboxMeshes: Mesh[] = []
    for (const skybox of skyboxes) {
      // Skybox has .mesh property
      if (skybox.mesh) {
        skyboxMeshes.push(skybox.mesh)
      }
      // Nightsky has separate starfield and moon meshes
      if (skybox.starfield) {
        skyboxMeshes.push(skybox.starfield)
      }
      if (skybox.moon) {
        skyboxMeshes.push(skybox.moon)
      }
    }
    this._ocean = new Ocean(CHUNK_SIZE, scene, skyboxMeshes)

    this._chunkSystem = new ChunkSystem(CHUNK_SIZE)
    this._chunkSystem.addObserver(this._oceanFloor)
    this._chunkSystem.addObserver(this._ocean)

    window.draw.addEventListener('distance-changed', (e) => {
      const newViewDistance = e.detail
      this._loadRange = Math.ceil((newViewDistance * 1.414 + CHUNK_SIZE / 2) / CHUNK_SIZE)
    })
  }

  get groundMeshes() {
    if (!this._islandsHasLoaded) {
      return []
    }
    return this._islands.allMeshes()
  }

  get islands() {
    return this._islands
  }

  get oceanFloor() {
    return this._oceanFloor
  }

  update() {
    const cam = this._scene.activeCamera
    if (!cam || !this._islandsHasLoaded || !isLoaded()) {
      return
    }

    if (this._scene.getFrameId() % 30 === 0) {
      this._islands.setVisibility(cam, 96)
      this._chunkSystem.updateChunksAroundPosition({ x: cam.position.x, z: cam.position.z }, this._loadRange)
    }
  }

  async load() {
    await this._islands.load()
    this._ocean.setIslands(this._islands)
    this._islandsHasLoaded = true
    this._islands.allMeshes().forEach((mesh) => this._ocean.addReflection(mesh))
  }

  addReflectionMesh(mesh: Mesh) {
    this._ocean.addReflection(mesh)
  }

  removeReflectionMesh(mesh: Mesh) {
    this._ocean.removeReflection(mesh)
  }

  hasWaterMeshAt(x: number, z: number) {
    return this._ocean.hasWaterMeshAt(x, z)
  }

  getIsland(point: Vec2) {
    return this._islands.getIsland(point)
  }
}
