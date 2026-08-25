import { isLoaded } from '../utils/loading-done'
import { StateObservable } from '../utils/state-observable'
import TerrainChunks from './terrain-chunks'

export class Terrain {
  public islandsStateObservable: StateObservable<'loaded' | 'unloaded'>
  public invalidateIslandsLoaded: () => void
  private readonly _scene: BABYLON.Scene
  private readonly _chunks: TerrainChunks
  private _hasLoaded = false

  constructor(scene: BABYLON.Scene, _skyboxes: any[]) {
    this._scene = scene
    this._chunks = new TerrainChunks(scene)
    this.islandsStateObservable = this._chunks.islandsStateObservable
    this.invalidateIslandsLoaded = () => this._chunks.invalidateIslandsLoaded()
  }

  get groundMeshes() {
    if (!this._hasLoaded) return []
    return this._chunks.groundMeshes
  }

  update() {
    const cam = this._scene.activeCamera
    if (!cam || !this._hasLoaded || !isLoaded()) return

    if (this._scene.getFrameId() % 30 === 0) {
      this._chunks.updateAround(cam.position.x, cam.position.z)
    }
  }

  async load() {
    const cam = this._scene.activeCamera
    const wx = cam?.position.x ?? 0
    const wz = cam?.position.z ?? 0
    await this._chunks.load(wx, wz)
    this._hasLoaded = true
  }

  // no-ops: water reflections died with ocean.ts
  addReflectionMesh(_mesh: BABYLON.Mesh) {}
  removeReflectionMesh(_mesh: BABYLON.Mesh) {}

  hasWaterMeshAt(x: number, z: number) {
    return this._chunks.hasWaterAt(x, 0, z)
  }

  hasLandAt(x: number, z: number) {
    return this._chunks.hasLandAt(x, z)
  }

  hasWaterAt(x: number, y: number, z: number) {
    return this._chunks.hasWaterAt(x, y, z)
  }
}
