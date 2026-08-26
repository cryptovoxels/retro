import { Environment } from '../enviroments/environment'
import { WorldEnvironment } from '../enviroments/world-environment'
import { SceneContext } from '@babylonjs/lite'

export async function createEnvironment(scene: SceneContext) {
  const environment: Environment = new WorldEnvironment(scene)
  await environment.load()
  return { environment }
}
