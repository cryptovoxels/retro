import { isDebug, wantsAudio, wantsGateway } from '../../common/helpers/detector'
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
import { startYeet } from '../yeetable'
import { updateWorldScene } from './world-scene'
import { setupRealmPopstate } from './realm'

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

  startGhosts(scene, grid, controls, connector)
  startYeet(scene, controls, canvas)

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
