import Grid from './grid'
import { Environment } from './enviroments/environment'
import { StateObservable } from './utils/state-observable'

class NullEnvironment extends Environment {
  private readonly groundState = new StateObservable<'loaded' | 'unloaded'>('loaded')

  constructor(parent: BABYLON.TransformNode, scene: BABYLON.Scene) {
    super(parent, scene)
  }

  get groundStateObservable() {
    return this.groundState
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
    return false
  }
}
