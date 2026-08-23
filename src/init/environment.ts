import { Environment } from '../enviroments/environment'
import { WorldEnvironment } from '../enviroments/world-environment'

export async function createEnvironment(scene: BABYLON.Scene) {
  const environment: Environment = new WorldEnvironment(scene)
  await environment.load()
  return { environment }
}
