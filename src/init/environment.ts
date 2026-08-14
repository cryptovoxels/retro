import { Environment } from '../enviroments/environment'
import { isScratchpad, isSpace, isWorld } from '../scene-config'
import { WorldEnvironment } from '../enviroments/world-environment'
import { SpacesEnvironment } from '../enviroments/space-environment'
import { ScratchpadEnvironment } from '../enviroments/scratchpad-environment'

export async function createEnvironment(scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
  let environment: Environment

  if (isScratchpad()) {
    environment = new ScratchpadEnvironment(parent, scene)
  } else if (isSpace()) {
    environment = new SpacesEnvironment(parent, scene)
  } else if (isWorld()) {
    environment = new WorldEnvironment(parent, scene)
  } else {
    throw new Error('Invalid Scene Config')
  }

  await environment.load()

  return { environment }
}
