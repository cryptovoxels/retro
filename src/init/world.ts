import { isDebug, isSkynet, robotFov, wantsAudio, wantsGateway, wantsRoboshot } from '../../common/helpers/detector'
import { startGateway } from '../gateway'
import { decodeCoords, encodeCoords } from '../../common/helpers/utils'
import { AudioEngine } from '../audio/audio-engine'
import Connector from '../connector'
import type Controls from '../controls/controls'
import PlayerCamera from '../controls/utils/player-camera'
import Grid from '../grid'
import { createGizmos } from '../tools/gizmos'
import { isLoaded } from '../utils/loading-done'
import { stepPhysics } from '../physics/world'
import { startGhosts } from '../ghosts'
import { watchWelcome } from '../ui/welcome'
import { updateWorldScene } from './world-scene'
import { setupRealmPopstate } from './realm'
import { currentVersion } from '../../common/version'

export const createWorld = async function (scene: BABYLON.Scene, canvas: HTMLCanvasElement, controls: Controls) {
  const grid = new Grid(scene)
  window.grid = grid
  controls.resetFloor()

  let audio: AudioEngine | null = null

  if (wantsAudio()) {
    try {
      audio = new AudioEngine(scene)
      window._audio = audio
    } catch (e: any) {
      console.error(`Unable to create audio engine\n\n${e.toString()}`)
      if (isDebug()) throw e
    }
  }

  const connector = initConnector(scene, controls, grid)
  if ((isSkynet() || wantsRoboshot()) && scene.activeCamera) scene.activeCamera.fov = robotFov()
  if (isSkynet()) loadSkynet()

  startGhosts(scene, grid, controls, connector)
  watchWelcome(scene)

  setupRealmPopstate()

  if (window.config.wantsURL) {
    updateNavbarWithCoords(scene, connector)
  }

  startGateway(scene, controls)

  if (audio) {
    const audioAbort = new AbortController()
    try {
      audio.start(audioAbort.signal)
    } catch (e: any) {
      console.error(`Unable to start audio engine\n\n${e.toString()}`)
      if (isDebug()) throw e
    }
  }

  if (!window.config.isBot) {
    scene.onAfterRenderObservable.add(() => {
      stepPhysics(scene.getEngine().getDeltaTime() / 1000)
    })

    scene.onAfterRenderObservable.add(() => {
      if (grid.currentW === 0) updateWorldScene()
    })
  }

  createGizmos(scene)

  return { grid, connector }
}

function initConnector(scene: BABYLON.Scene, controls: Controls, grid: Grid): Connector {
  return new Connector(scene, grid, controls)
}

function updateNavbarWithCoords(scene: BABYLON.Scene, connector: Connector) {
  let oldUrl = '/'
  let lastPos: BABYLON.Vector3 | null = null
  setInterval(() => {
    if (wantsGateway()) return
    if (window.grid?.currentW !== 0) return
    if (isLoaded()) {
      const queryParams = new URLSearchParams(document.location.search.substring(1))
      const camera = scene.activeCamera as PlayerCamera
      const coords = {
        position: connector.persona.position.clone(),
        rotation: camera.rotation.clone(),
      }
      if (coords.position.y < -10) return
      // only rewrite the url after moving 1m, otherwise replaceState spam kills typing in inputs
      if (lastPos && BABYLON.Vector3.Distance(lastPos, coords.position) < 1) return
      lastPos = coords.position
      const coordsParam = encodeCoords(coords)
      queryParams.set('coords', coordsParam)
      const params = queryParams.toString().replace('%40', '@').replace(/%2C/g, ',')
      if (!document.getElementsByClassName('client')[0]) return
      const path = document.location.pathname
      const url = params ? `${path}?${params}` : path
      if (url !== oldUrl) {
        oldUrl = url
        history.replaceState(coordsParam, 'Voxels', url)
      }
    }
  }, 200)

  window.addEventListener('popstate', (e) => {
    if (window.grid?.currentW !== 0) return
    if (e.state) connector.persona.teleportNoHistory(decodeCoords(e.state))
  })
}

// the skynet api is its own bundle next to app.js (same paths as render-component appJs), players never download it
function loadSkynet() {
  const s = document.createElement('script')
  s.type = 'module'
  s.src = (process.env.NODE_ENV === 'development' ? '/proxy/web' : '') + `/${currentVersion}-skynet.js`
  document.head.append(s)
}
