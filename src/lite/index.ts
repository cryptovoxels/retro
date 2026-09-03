import * as L from '@babylonjs/lite'
import { decodeCoords } from '../../common/helpers/utils'
import PlayerBody from '../controls/utils/player-body'
import { initPhysics, stepPhysics } from '../physics/world'
import { liteAvatars } from './avatars'
import { liteControls } from './controls'
import { liteGrid } from './grid'
import { liteIslands } from './islands'

// experimental webgpu runtime. no BABYLON Engine/Scene/Mesh/Material/Texture is ever created here,
// only the babylon-free pipeline (grid worker, lightmap bake, vox worker, rapier, PlayerBody) is reused
export type Lite = { L: typeof L; engine: L.EngineContext; scene: L.SceneContext; body: PlayerBody }

let booted: Promise<null> | null = null

export function bootLite() {
  return (booted ??= start())
}

async function start(): Promise<null> {
  const canvas = document.createElement('canvas')
  canvas.id = 'renderCanvas'
  canvas.style.cssText = 'width: 100%; height: 100%; display: none; touch-action: none;'
  document.body.appendChild(canvas)

  // no hud in lite, so this is the only way back to babylon
  const back = document.createElement('a')
  back.href = '#'
  back.textContent = 'experimental renderer. back to babylon'
  back.style.cssText = 'position: fixed; right: 1rem; bottom: 1rem; z-index: 1;'
  back.onclick = (e) => {
    e.preventDefault()
    // via the url, not localStorage: ?renderer=lite in the address bar would re-stick on reload
    const u = new URL(location.href)
    u.searchParams.set('renderer', 'babylon')
    location.href = u.toString()
  }
  document.body.appendChild(back)

  L.enableStandardVertexColors()
  L.enableStandardUvOffset()
  const engine = await L.createEngine(canvas)
  const scene = L.createSceneContext(engine)
  scene.clearColor = { r: 0.53, g: 0.8, b: 0.92, a: 1 }
  L.addToScene(scene, L.createHemisphericLight([0, 1, 0], 1))
  // the engine loop resizes every frame, this just stops it reading layout
  L.enableSurfaceResizeObserver(engine)

  await initPhysics()
  const body = new PlayerBody()
  const coords = new URLSearchParams(location.search).get('coords')
  const spawn = decodeCoords(coords)
  const home = coords ? { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z } : { x: Math.random() * 8 - 4, y: 2.5, z: Math.random() * 8 - 4 }
  Object.assign(body.position, home)

  const cam = L.createFreeCamera({ ...home }, { x: home.x, y: home.y, z: home.z + 1 })
  cam.fov = 0.8
  cam.nearPlane = 0.1
  cam.farPlane = 1000
  scene.camera = cam

  const lite: Lite = { L, engine, scene, body }
  const controls = liteControls(canvas, body, cam, spawn.rotation?.y ?? 0)
  const grid = liteGrid(lite)
  liteIslands(lite)
  const avatars = liteAvatars(lite, controls)

  L.onBeforeRender(scene, (ms) => {
    const dt = Math.min(ms / 1000, 0.1)
    controls.step(dt)
    stepPhysics(dt)
    grid.tick()
    avatars.tick()
    // fell through the world: back to spawn
    if (body.position.y < -30) Object.assign(body.position, home)
  })
  await L.registerScene(scene)
  await L.startEngine(engine)
  return null
}
