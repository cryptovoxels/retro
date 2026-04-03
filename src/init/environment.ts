import { Environment } from '../enviroments/environment'
import RegionalManager from '../regional-effects-manager'
import { isSpace, isWorld, Scene } from '../scene'
import { easeInSineDistance } from '../utils/easing'
import { WorldEnvironment } from '../enviroments/world-environment'
import { SpacesEnvironment } from '../enviroments/space-environment'
import { ScratchpadEnvironment } from '../enviroments/scratchpad-environment'

function isScratchpad(scene: Scene) {
  return window.location.pathname.includes('scratchpad')
}

export async function createEnvironment(scene: Scene, parent: BABYLON.TransformNode) {
  let environment: Environment

  if (isScratchpad(scene)) {
    environment = new ScratchpadEnvironment(parent, scene)
  } else if (isSpace(scene)) {
    environment = new SpacesEnvironment(parent, scene)
  } else if (isWorld(scene)) {
    environment = new WorldEnvironment(parent, scene)
  } else {
    throw new Error('Invalid Scene Config')
  }

  await environment.load()

  const regions = new RegionalManager(scene)
  // @ts-expect-error for debug
  window._regions = regions

  if (environment instanceof WorldEnvironment) {
    setupCustomSkyboxes(regions, environment)
  }

  return { environment, regions }
}

function setupCustomSkyboxes(regions: RegionalManager, environment: WorldEnvironment) {
  regions.addEventListener('skybox-entered', ({ detail }) => {
    const easedStrength = easeInSineDistance(detail.strength)
    // this will also exit any existing skybox
    if (environment.customSkybox) {
      environment.customSkybox.setSkybox(detail.value, easedStrength)
    }
  })

  regions.addEventListener('skybox-exited', ({ detail }) => {
    // only exits if the exited skybox is the current skybox
    if (environment.customSkybox?.currentSkybox === detail.value) {
      environment.customSkybox.clearSkybox()
    }
  })
}
