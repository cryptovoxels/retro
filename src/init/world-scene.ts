import { wantsGateway } from '../../common/helpers/detector'
import { OCEAN_HEIGHT_OFFSET } from '../constants'
import { hideGatewayBackdrop } from '../gateway'
import Horizon from '../terrain/horizon'
import Skybox from '../terrain/skybox'
import { Terrain } from '../terrain/terrain'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { StateObservable } from '../utils/state-observable'
import { TimeOfDay } from '../utils/time-of-day'
import { cameraPosition } from '../utils/camera'
import { DAY_FOG_COLOR, DAY_SUN_POSITION, NIGHT_FOG_COLOR, NIGHT_SUN_POSITION } from '../enviroments/world-environment-constants'
import { addCuboid, removeCollider } from '../physics/world'

const AMBIENT = 0.3
const GATEWAY_AMBIENT = 0.45

export type WorldSceneEvents = {
  'fog-updated': void
  'parcel-collider-added': BABYLON.AbstractMesh
  'parcel-collider-removed': BABYLON.AbstractMesh
}

export const worldSceneEvents = new TypedEventTarget<WorldSceneEvents>()

let scene: BABYLON.Scene | null = null
let terrain: Terrain | undefined
let horizon: Horizon | undefined
let skybox: Skybox | undefined
let ambientLight: BABYLON.HemisphericLight | undefined
let groundStateObservable: StateObservable<'loaded' | 'unloaded'> | undefined
let timeOfDay: TimeOfDay = TimeOfDay.Day
let isNightCache: boolean | null = null
let isUnderwaterCache: boolean | null = null
let loaded = false

function ambient() {
  return wantsGateway() ? GATEWAY_AMBIENT : AMBIENT
}

function fogDensity() {
  if (wantsGateway()) return 0
  return Math.max(3 / window.draw.distance - 0.006, 0)
}

function isUnderwater() {
  if (!scene?.activeCamera) return false
  const cameraPos = cameraPosition(scene)
  if (cameraPos.y >= OCEAN_HEIGHT_OFFSET + 0.3) return false
  if (terrain?.getIsland(new BABYLON.Vector2(cameraPos.x, cameraPos.z))) return false
  return terrain?.hasWaterMeshAt(cameraPos.x, cameraPos.z) || false
}

function sunPosition() {
  return timeOfDay === TimeOfDay.Night ? NIGHT_SUN_POSITION : DAY_SUN_POSITION
}

function fogColor() {
  if (isUnderwater()) return new BABYLON.Color3(0.2, 0.2, 0.2)
  return timeOfDay === TimeOfDay.Night ? NIGHT_FOG_COLOR : DAY_FOG_COLOR
}

function clearColor() {
  if (isUnderwater()) return new BABYLON.Color4(0.03, 0.03, 0.03, 1)
  return new BABYLON.Color4(0, 0, 0, 0)
}

function updateFog(s: BABYLON.Scene) {
  if (isUnderwater()) {
    s.fogMode = BABYLON.Scene.FOGMODE_EXP2
    s.fogDensity = 0.12
    s.fogColor = fogColor()
    return
  }
  s.fogMode = BABYLON.Scene.FOGMODE_EXP2
  s.fogDensity = fogDensity()
  s.fogColor = fogColor()
  worldSceneEvents.dispatchEvent(createEvent('fog-updated', undefined))
}

function onEnvironmentStateChanged() {
  if (!scene) return
  updateFog(scene)
  scene.clearColor = clearColor()
  ;(window as any).engine?.setUnderwater?.(isUnderwater())
}

export function getWorldGroundState(): StateObservable<'loaded' | 'unloaded'> {
  if (!groundStateObservable) throw new Error('createWorldScene() not called')
  return groundStateObservable
}

export function getWorldTimeOfDay() {
  return timeOfDay
}

export function setWorldTimeOfDay(t: TimeOfDay) {
  if (timeOfDay === t) return
  timeOfDay = t
  updateWorldScene()
}

export function getWorldTerrain() {
  return terrain
}

export function worldSceneLoaded() {
  return loaded
}

export async function createWorldScene(s: BABYLON.Scene) {
  if (loaded && scene === s) return
  teardownWorldScene()
  scene = s
  timeOfDay = window.config.isNight ? TimeOfDay.Night : TimeOfDay.Day

  s.clearColor = clearColor()
  updateFog(s)

  ambientLight = new BABYLON.HemisphericLight('sun', sunPosition(), s)
  ambientLight.intensity = 1.0

  window.draw.addEventListener('distance-changed', () => scene && updateFog(scene), { passive: true })
  window.graphic.addEventListener('settingsChanged', () => scene && updateFog(scene), { passive: true })

  skybox = new Skybox(s)
  terrain = new Terrain(s, [skybox])
  groundStateObservable = terrain.islandsStateObservable
  horizon = new Horizon(s)
  await terrain.load()

  loaded = true
  isNightCache = null
  isUnderwaterCache = null
}

export function teardownWorldScene() {
  loaded = false
  skybox?.mesh?.dispose()
  skybox = undefined
  if (terrain) {
    try {
      ;(terrain as any)._ocean?.dispose?.()
    } catch {}
    terrain.groundMeshes.forEach((m) => m.dispose())
  }
  terrain = undefined
  ;(horizon as any)?.mesh?.dispose?.()
  horizon = undefined
  ambientLight?.dispose()
  ambientLight = undefined
  groundStateObservable = undefined
  isNightCache = null
  isUnderwaterCache = null
}

export function updateWorldScene() {
  if (!loaded || !scene) return

  const night = timeOfDay === TimeOfDay.Night
  const underwater = isUnderwater()
  const changed = night !== isNightCache || underwater !== isUnderwaterCache
  isNightCache = night
  isUnderwaterCache = underwater

  if (changed) onEnvironmentStateChanged()

  skybox?.update(sunPosition(), 0.5)
  if (skybox) skybox.mesh.isVisible = !underwater
  horizon?.update(BABYLON.Engine.ALPHA_COMBINE, fogColor())
  horizon?.setVisible(!underwater)
  hideGatewayBackdrop(skybox, horizon)
  terrain?.update()
}

export function parcelMeshesAdded(meshes: BABYLON.Mesh[]) {
  meshes.filter(Boolean).forEach((parcelMesh) => {
    terrain?.addReflectionMesh(parcelMesh)
    if (parcelMesh.name.startsWith('voxel-field/opaque')) {
      worldSceneEvents.dispatchEvent(createEvent('parcel-collider-added', parcelMesh))
    }
  })
}

export function parcelMeshesRemoved(meshes: BABYLON.Mesh[]) {
  meshes.filter(Boolean).forEach((parcelMesh) => {
    terrain?.removeReflectionMesh(parcelMesh)
    if (parcelMesh.name.startsWith('voxel-field/opaque')) {
      worldSceneEvents.dispatchEvent(createEvent('parcel-collider-removed', parcelMesh))
    }
  })
}

// flat grey backdrop for w>0 space slices
let spaceGround: BABYLON.Mesh | undefined

export function createSpaceScene(s: BABYLON.Scene) {
  teardownWorldScene()
  scene = s
  s.clearColor = new BABYLON.Color4(0.45, 0.45, 0.45, 1)
  s.fogMode = BABYLON.Scene.FOGMODE_NONE
  s.fogDensity = 0

  ambientLight = new BABYLON.HemisphericLight('sun', new BABYLON.Vector3(0, 1, 0), s)
  ambientLight.intensity = 1.0

  spaceGround = BABYLON.MeshBuilder.CreatePlane('space/ground', { size: 512 }, s)
  spaceGround.rotate(BABYLON.Axis.X, Math.PI / 2)
  spaceGround.position.y = 0
  const mat = new BABYLON.StandardMaterial('space/ground', s)
  mat.diffuseColor.set(0.5, 0.5, 0.5)
  mat.specularColor.set(0, 0, 0)
  spaceGround.material = mat
  const half = 256
  const hy = 0.5
  addCuboid('space-ground', { x: half, y: hy, z: half }, { x: 0, y: -hy, z: 0 })
}

export function teardownSpaceScene() {
  removeCollider('space-ground')
  spaceGround?.dispose()
  spaceGround = undefined
  ambientLight?.dispose()
  ambientLight = undefined
}
