import { afterEach, beforeEach, expect, test } from 'vitest'
import { meshCandidates } from '../src/utils'

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene
let camera: BABYLON.FreeCamera
beforeEach(() => {
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -10), scene)
  camera.setTarget(BABYLON.Vector3.Zero())
  scene.updateTransformMatrix(true)
})
afterEach(() => {
  scene.dispose()
  engine.dispose()
})

function box(x: number) {
  const mesh = BABYLON.MeshBuilder.CreateBox('box', {}, scene)
  mesh.position.x = x
  mesh.freezeWorldMatrix()
  return mesh
}

function selected() {
  const list = scene.getActiveMeshCandidates()
  return list.data.slice(0, list.length)
}

test('only skips off-screen frozen meshes, and follows camera rotation', () => {
  const front = box(0)
  const side = box(100)
  const moving = box(-100)
  moving.unfreezeWorldMatrix()
  meshCandidates(scene)
  expect(selected()).toEqual([front, moving])
  camera.setTarget(side.position)
  scene.updateTransformMatrix(true)
  expect(selected()).toContain(side)
  expect(selected()).toContain(moving)
})

test('keeps instance sources, explicit visibility and action managers', () => {
  const source = box(100)
  const instance = source.createInstance('instance')
  instance.position.x = 0
  instance.freezeWorldMatrix()
  const forced = box(200)
  forced.alwaysSelectAsActiveMesh = true
  const trigger = box(300)
  trigger.actionManager = new BABYLON.ActionManager(scene)
  meshCandidates(scene)
  expect(selected()).toEqual([source, instance, forced, trigger])
})

test('handles streaming removal, replacement, and edited bounds immediately', () => {
  const old = box(0)
  meshCandidates(scene)
  expect(selected()).toEqual([old])
  old.dispose()
  const fresh = box(100)
  expect(selected()).toEqual([])
  fresh.unfreezeWorldMatrix()
  fresh.position.x = 0
  fresh.freezeWorldMatrix()
  expect(selected()).toEqual([fresh])
})

test('preserves the full path when clipping is disabled or LOD is customized', () => {
  const mesh = box(100)
  meshCandidates(scene)
  scene.skipFrustumClipping = true
  expect(selected()).toEqual([mesh])
  scene.skipFrustumClipping = false
  scene.customLODSelector = (mesh) => mesh
  expect(selected()).toEqual([mesh])
})

test('Babylon renders the same active meshes with an off-screen instance source', () => {
  const source = box(100)
  source.material = new BABYLON.StandardMaterial('shared', scene)
  const instance = source.createInstance('visible instance')
  instance.position.x = 0
  instance.freezeWorldMatrix()
  box(-100)
  scene.render()
  const active = () =>
    scene
      .getActiveMeshes()
      .data.slice(0, scene.getActiveMeshes().length)
      .map((mesh) => mesh.uniqueId)
  const before = active()
  expect(before).toContain(instance.uniqueId)
  meshCandidates(scene)
  scene.render()
  expect(active()).toEqual(before)
  instance.unfreezeWorldMatrix()
  instance.position.x = 100
  instance.freezeWorldMatrix()
  scene.render()
  expect(active()).not.toContain(instance.uniqueId)
})
