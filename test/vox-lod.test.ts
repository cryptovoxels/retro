import { afterEach, beforeEach, expect, test } from 'vitest'
import { featureLOD } from '../src/utils'

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene
let camera: BABYLON.FreeCamera
beforeEach(() => {
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -10), scene)
})
afterEach(() => {
  scene.dispose()
  engine.dispose()
})

function model(faces = 12) {
  const mesh = BABYLON.MeshBuilder.CreateBox('vox', { width: 2, height: 3, depth: 4 }, scene)
  if (faces !== 12) mesh.setIndices(Array.from({ length: faces * 3 }, (_, i) => i % 3))
  mesh.computeWorldMatrix(true)
  featureLOD({ mesh, type: 'vox-model' } as any)
  return mesh
}

function distance(value: number) {
  camera.position.set(0, 0, -value)
  camera.getViewMatrix(true)
}

test('small vox models switch to cube LOD0 only beyond 16 metres', () => {
  const mesh = model()
  distance(16)
  expect(mesh.getLOD(camera)).toBe(mesh)
  distance(16.01)
  const cube = mesh.getLOD(camera)!
  expect(cube.metadata.lod).toBe(0)
  expect(cube.getTotalIndices()).toBe(36)
  expect(cube.getBoundingInfo().boundingBox.extendSize.asArray()).toEqual(mesh.getBoundingInfo().boundingBox.extendSize.asArray())
  distance(2)
  expect(mesh.getLOD(camera)).toBe(mesh)
})

test('more than 1000 triangle faces uses LOD1 at every distance, including zero', () => {
  const light = model(1000),
    heavy = model(1001)
  for (const at of [0, 10, 17, 1000]) {
    distance(at)
    expect(heavy.getLOD(camera)!.metadata.lod).toBe(1)
    expect(heavy.getLOD(camera)!.getTotalIndices()).toBe(36)
  }
  distance(0)
  expect(light.getLOD(camera)).toBe(light)
})

test('instance bounds choose their own LOD; repeats reuse it and disposing removes it', () => {
  const mesh = model()
  const instance = mesh.createInstance('far instance')
  instance.position.x = 100
  instance.computeWorldMatrix(true)
  distance(0)
  expect(mesh.getLOD(camera)).toBe(mesh)
  const cube = mesh.getLOD(camera, instance.getBoundingInfo().boundingSphere)!
  expect(cube.metadata.lod).toBe(0)
  featureLOD({ mesh, type: 'vox-model' } as any)
  expect(mesh.getLODLevels()).toHaveLength(1)
  mesh.dispose()
  expect(cube.isDisposed()).toBe(true)
})
