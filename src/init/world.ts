import { isDebug, wantsAudio } from '../../common/helpers/detector'
import { decodeCoords, encodeCoords } from '../../common/helpers/utils'
import { app } from '../../web/src/state'
import { AudioEngine } from '../audio/audio-engine'
import Connector from '../connector'
import type Controls from '../controls/controls'
import OurCamera from '../controls/utils/our-camera'
import { Environment } from '../enviroments/environment'
import Grid from '../grid'
import { ParcelMesher } from '../parcel-mesher'
import type { Scene } from '../scene'
import { createGizmos } from '../tools/gizmos'
import { isLoaded } from '../utils/loading-done'

export const createWorld = async function (scene: Scene, canvas: HTMLCanvasElement, controls: Controls, environment: Environment) {
  const parcelMesher = new ParcelMesher(scene)
  await parcelMesher.initialize()

  const grid = new Grid(scene, controls.worldOffset, environment, scene.config.spaceId ?? undefined)
  if (scene.config.isGrid) {
    grid.loadWorker()
  }
  window.grid = grid

  let audio: AudioEngine | null = null

  if (wantsAudio()) {
    try {
      audio = new AudioEngine(scene, grid)
      window._audio = audio
    } catch (e: any) {
      console.error(`Unable to create audio engine\n\n${e.toString()}`)
      if (isDebug()) {
        throw e
      }
    }
  }

  const connector = initConnector(scene, controls, grid)

  await grid.loadFastbootFromHTML()

  if (scene.config.wantsURL) {
    updateNavbarWithCoords(scene, connector)
  }

  initialSpawn(scene, grid, controls)

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

  if (!scene.config.isBot) {
    // wait for ground to load before applying gravity
    // stops us from falling through collidable mega vox (etc) before they have loaded
    controls.invalidateGroundLoaded()

    scene.onAfterRenderObservable.add(() => {
      controls.refreshGravity()
    })

    // start the environment load loop (which will load water on demand)
    scene.onAfterRenderObservable.add(() => {
      environment.update()
    })
  }

  // wait 10 seconds for the first parcel to load
  // If nothing has loaded by then we're probably out at sea, manually mark as loaded so that the loading screen goes away
  setTimeout(() => {
    if (!grid.length) {
      console.warn('No parcels loaded, marking as loaded')
    }
  }, 10e3)

  createGizmos(scene)

  return { grid, connector }
}

function initConnector(scene: Scene, controls: Controls, grid: Grid): Connector {
  const connector = new Connector(scene, controls.worldOffset, grid, controls)
  if (scene.config.isMultiuser) {
    connector.connect()
  }
  return connector
}

function parseFloatOrZero(value: string | null | number): number {
  if (!value) return 0
  if (typeof value === 'number') return value

  return parseFloat(value)
}

//Randomize initial center spawning coordinates (no more overlapping avatars) when 'coords' param is null in-world
// For spaces, if coords is null, we look for a spawn point
function initialSpawn(scene: Scene, grid: Grid, controls: Controls) {
  const searchParams = new URLSearchParams(document.location.search.substring(1))
  if (searchParams.get('coords')) {
    // Coords is not null, don't randomize spawn at center in-world
    return
  }
  if (scene.config.isSpace) {
    // if is space, then try find a Spawn point, else the user just spawns at 0,0
    if (!grid.fastbootParcel) {
      return
    }
    const space = grid.fastbootParcel
    const spawnFeature = space.content?.features?.find((f) => f?.type === 'spawn-point')

    if (spawnFeature) {
      const spawnPosition = Array.isArray(spawnFeature.position) ? spawnFeature.position : ([spawnFeature.position.x, spawnFeature.position.y, spawnFeature.position.z] as const)
      const rotation = Array.isArray(spawnFeature.rotation) ? spawnFeature.rotation : ([spawnFeature.rotation.x, spawnFeature.rotation.y, spawnFeature.rotation.z] as const)

      const yRotation = parseFloatOrZero(rotation[1])

      const center = [(space.x2 + space.x1) / 200, (space.z2 + space.z1) / 200]
      const roundHalf = (v: number) => Math.round(v * 2) / 2

      const z = roundHalf(center[1] * 100 + parseFloatOrZero(spawnPosition[2]))
      const x = roundHalf(center[0] * 100 + parseFloatOrZero(spawnPosition[0]))

      const y = parseFloatOrZero(spawnPosition[1]) + 1.75

      controls.camera.position = new BABYLON.Vector3(x, y, z)
      controls.camera.rotation = new BABYLON.Vector3(0, yRotation, 0)
    }
  } else {
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

    controls.camera.position = new BABYLON.Vector3(randomX, 2.5, randomZ)
  }
}

// Show params as NESW coordinates
function updateNavbarWithCoords(scene: BABYLON.Scene, connector: Connector) {

  if (document.location.pathname.match(/scratchpad/)) {
    return
  }

  let oldUrl = '/'
  setInterval(() => {
    if (isLoaded()) {
      // Grab new searchParams
      const queryParams = new URLSearchParams(document.location.search.substring(1))

      const camera = scene.activeCamera as OurCamera

      const coords = {
        position: connector.persona.position.clone(),
        rotation: camera.rotation.clone(),
        flying: connector.controls.flying,
      }

      const coordsParam = encodeCoords(coords)

      // preserve other url params
      queryParams.set('coords', coordsParam)
      const params = queryParams.toString().replace('%40', '@').replace(/%2C/g, ',')

      const url = params ? '/play?' + params : '/play'

      const current = window.grid?.currentParcel()

      if (window === window.parent && url !== oldUrl) {
        // not a nested iframe, so update the url
        oldUrl = url
        history.replaceState(coordsParam, 'Voxels', url)
        app.send({ type: 'navigate', data: url })
      } else if (current) {
        // send current parcel data to parent iframe
        window.parent.postMessage({ type: 'parcel', parcel: { ...current.summary } }, '*')
      }
    }
  }, 200)

  window.addEventListener('popstate', (e) => {
    if (e.state) {
      connector.persona.teleportNoHistory(decodeCoords(e.state))
    }
  })
}
