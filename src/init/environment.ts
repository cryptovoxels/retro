import { Environment } from '../enviroments/environment'
import { WorldEnvironment } from '../enviroments/world-environment'

export async function createEnvironment(scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
  const environment: Environment = new WorldEnvironment(parent, scene)
  await environment.load()
  return { environment }
}
