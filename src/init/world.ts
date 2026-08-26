import { isDebug, wantsAudio } from '../../common/helpers/detector'
import { startGateway } from '../gateway'
import { AudioEngine } from '../audio/audio-engine'
import Connector from '../connector'
import type Controls from '../controls/controls'
import { Environment } from '../enviroments/environment'
import Grid from '../grid'
import { createGizmos } from '../tools/gizmos'
import { stepPhysics } from '../physics/world'
import { startGhosts } from '../ghosts'
import { startYeet } from '../yeetable'
import { SceneContext } from '@babylonjs/lite'

export const createWorld = async function (scene: SceneContext, canvas: HTMLCanvasElement, controls: Controls, environment: Environment) {
  const grid = new Grid(scene, environment)
  if (window.config.isGrid) {
    grid.loadWorker()
  }
  window.grid = grid

  let audio: AudioEngine | null = null

  if (wantsAudio()) {
    try {
      audio = new AudioEngine(scene)
      window._audio = audio
    } catch (e: any) {
      console.error(`Unable to create audio engine\n\n${e.toString()}`)
      if (isDebug()) {
        throw e
      }
    }
  }

  const connector = initConnector(scene, controls, grid)

  startGhosts(scene, grid, controls, connector)
  startYeet(scene, controls, canvas)

  await grid.loadFastbootFromHTML()

  initialSpawn(scene, grid, controls)
  startGateway(scene, controls)

  if (audio) {
    // todo make use of this abort controller
    const audioAbort = new AbortController()
    try {
      // Fire-and-forget, since browsers may disable audio autoplay when they feel like it: https://developer.chrome.com/blog/autoplay/
      audio.start(audioAbort.signal)
    } catch (e: any) {
      console.error(`Unable to start audio engine\n\n${e.toString()}`)
      if (isDebug()) {
        throw e
      }
    }
  }

  if (!window.config.isBot) {
    // wait for ground to load before applying gravity
    // stops us from falling through collidable mega vox (etc) before they have loaded
    controls.invalidateGroundLoaded()

    scene.onAfterRenderObservable.add(() => {
      stepPhysics(scene.getEngine().getDeltaTime() / 1000)
    })

    // start the environment load loop (which will load water on demand)
    scene.onAfterRenderObservable.add(() => {
      environment.update()
    })
  }

  // wait 3 seconds for the first parcel to load
  // If nothing has loaded by then we're probably out at sea — lift the grey cover
  setTimeout(() => {
    window.graphic?.postProcesses?.reveal()
  }, 3e3)

  createGizmos(scene)

  return { grid, connector }
}

function initConnector(scene: SceneContext, controls: Controls, grid: Grid): Connector {
  const connector = new Connector(scene, grid, controls)
  if (window.config.isMultiuser) {
    connector.connect()
  }
  return connector
}

//Randomize initial center spawning coordinates (no more overlapping avatars) when 'coords' param is null in-world
function initialSpawn(_scene: SceneContext, _grid: Grid, controls: Controls) {
  const random_boolean = Math.random() < 0.5
  const nudgeL = 5
  const nudgeW = 2
  //if random_boolean is true nudge the player along the X walkway
  let randomX = Math.random() * (nudgeL - -nudgeL) + -nudgeL
  let randomZ = Math.random() * (nudgeW - -nudgeW) + -nudgeW
  //if random_boolean is false nudge the player along the Z walkway
  if (!random_boolean) {
    randomX = Math.random() * (nudgeW - -nudgeW) + -nudgeW
    randomZ = Math.random() * (nudgeL - -nudgeL) + -nudgeL
  }

  controls.body.position.set(randomX, 2.5, randomZ)
}
