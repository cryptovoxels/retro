import Grid from './grid'
import { Environment } from './enviroments/environment'
import { StateObservable } from './utils/state-observable'
import type { ParcelRecord } from '../common/messages/parcel'
import type Parcel from './parcel'

class NullEnvironment extends Environment {
  private readonly groundState = new StateObservable<'loaded' | 'unloaded'>('loaded')

  constructor(parent: BABYLON.TransformNode, scene: BABYLON.Scene) {
    super(parent, scene)
  }

  get groundStateObservable() {
    return this.groundState
  }

  get fogDensity() {
    return 0
  }

  updateFog(scene: BABYLON.Scene) {
    scene.fogMode = BABYLON.Scene.FOGMODE_NONE
    scene.fogDensity = 0
  }

  invalidateGroundLoaded() {}

  update() {}

  parcelMeshesAdded(_meshes: BABYLON.Mesh[]) {}

  parcelMeshesRemoved(_meshes: BABYLON.Mesh[]) {}
}

export class NullGrid extends Grid {
  constructor(scene: BABYLON.Scene) {
    const parent = new BABYLON.TransformNode('parcel/parent', scene)
    super(scene, parent, new NullEnvironment(parent, scene))
  }

  get seeksConnection() {
    return false
  }

  get hasField() {
    return true
  }

  // Preview has no draw-distance refresh loop.
  protected addInterval(_func: () => void, _intervalMs: number) {}

  spawnPreview(record: ParcelRecord): Parcel | undefined {
    return super.spawnPreview(record)
  }

  async preparePreview() {
    window.environment = this.environment
    await this.environment.load()
  }
}
