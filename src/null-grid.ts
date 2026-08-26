import Grid from './grid'
import { Environment } from './enviroments/environment'
import { StateObservable } from './utils/state-observable'
import type { ParcelRecord } from '../common/messages/parcel'
import type Parcel from './parcel'
import { Mesh, SceneContext } from '@babylonjs/lite'

class NullEnvironment extends Environment {
  private readonly groundState = new StateObservable<'loaded' | 'unloaded'>('loaded')

  constructor(scene: SceneContext) {
    super(scene)
  }

  get groundStateObservable() {
    return this.groundState
  }

  get fogDensity() {
    return 0
  }

  updateFog(scene: SceneContext) {
    scene.fogMode = (undefined as any /* todo(lite): BABYLON.Scene.FOGMODE_NONE */)
    scene.fogDensity = 0
  }

  invalidateGroundLoaded() {}

  update() {}

  parcelMeshesAdded(_meshes: Mesh[]) {}

  parcelMeshesRemoved(_meshes: Mesh[]) {}
}

export class NullGrid extends Grid {
  constructor(scene: SceneContext) {
    super(scene, new NullEnvironment(scene))
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
