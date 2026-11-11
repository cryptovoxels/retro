import { afterEach, beforeEach, expect, test } from 'vitest'
import { featureLOD, freezeFeature, thawFeature } from '../src/utils'

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene
beforeEach(() => {
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
})
afterEach(() => {
  scene.dispose()
  engine.dispose()
})

function feature(type = 'image', mesh: BABYLON.TransformNode = BABYLON.MeshBuilder.CreateBox('feature', {}, scene)) {
  const f: any = { type, mesh, description: {}, disposed: false, renderEditing: false }
  ;(mesh as any).feature = f
  if (mesh instanceof BABYLON.Mesh) mesh.material = new BABYLON.StandardMaterial('material', scene)
  return f
}

test('placed features freeze, then edits update world bounds and picking', () => {
  const f = feature()
  freezeFeature(f)
  expect(f.mesh.isWorldMatrixFrozen).toBe(true)
  expect(f.mesh.material.isFrozen).toBe(false)
  thawFeature(f)
  f.mesh.position.x = 10
  freezeFeature(f)
  expect(f.mesh.getBoundingInfo().boundingBox.centerWorld.x).toBe(10)
  const hit = scene.pickWithRay(new BABYLON.Ray(new BABYLON.Vector3(10, 0, -5), BABYLON.Axis.Z))
  expect(hit?.pickedMesh).toBe(f.mesh)
})

test('moving a rotated and scaled group updates frozen descendants', () => {
  const group = feature('group', new BABYLON.TransformNode('group', scene))
  const child = feature()
  child.mesh.parent = group.mesh
  child.mesh.position.x = 2
  freezeFeature(group)
  thawFeature(group)
  group.mesh.position.set(3, 4, 5)
  group.mesh.rotation.y = Math.PI / 2
  group.mesh.scaling.set(-2, 3, 4)
  freezeFeature(group)
  const expected = BABYLON.Vector3.TransformCoordinates(child.mesh.position, group.mesh.computeWorldMatrix(true))
  expect(BABYLON.Vector3.Distance(child.mesh.getAbsolutePosition(), expected)).toBeLessThan(0.00001)
  expect(child.mesh.isWorldMatrixFrozen).toBe(true)
})

test('group editing and animation keep descendants dynamic', () => {
  const group = feature('group', new BABYLON.TransformNode('group', scene))
  const child = feature()
  child.mesh.parent = group.mesh
  freezeFeature(group)
  group.renderEditing = true
  thawFeature(group)
  freezeFeature(group)
  expect(child.mesh.isWorldMatrixFrozen).toBe(false)
  group.renderEditing = false
  group.description.animation = { destination: 'rotation' }
  freezeFeature(group)
  expect(child.mesh.isWorldMatrixFrozen).toBe(false)
})

test('late replacement meshes freeze their own transform', () => {
  const f = feature()
  freezeFeature(f)
  f.mesh.dispose()
  f.mesh = BABYLON.MeshBuilder.CreateBox('replacement', {}, scene)
  f.mesh.feature = f
  f.mesh.material = new BABYLON.StandardMaterial('replacement', scene)
  freezeFeature(f)
  expect(f.mesh.isWorldMatrixFrozen).toBe(true)
  expect(f.mesh.material.isFrozen).toBe(false)
})

test('instances retain their source material and independent placement', () => {
  const source = feature('cube')
  const instance = feature('cube', source.mesh.createInstance('instance'))
  instance.mesh.position.x = 8
  source.mesh.material.freeze()
  freezeFeature(source)
  freezeFeature(instance)
  thawFeature(instance)
  expect(source.mesh.material.isFrozen).toBe(true)
  instance.mesh.position.x = 12
  freezeFeature(instance)
  expect(instance.mesh.material).toBe(source.mesh.material)
  expect(source.mesh.getAbsolutePosition().x).toBe(0)
  expect(instance.mesh.getAbsolutePosition().x).toBe(12)
})

test('moving feature types and billboards are excluded', () => {
  for (const type of ['ride', 'video', 'portal', 'particle-system']) {
    const f = feature(type)
    freezeFeature(f)
    expect(f.mesh.isWorldMatrixFrozen).toBe(false)
  }
  const f = feature()
  f.mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL
  freezeFeature(f)
  expect(f.mesh.isWorldMatrixFrozen).toBe(false)
})

test('Babylon hides features past 50m without disposing them and restores them nearby', () => {
  const f = feature()
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -20), scene)
  f.mesh.computeWorldMatrix(true)
  featureLOD(f)
  featureLOD(f)
  expect(f.mesh.getLODLevels()).toHaveLength(1)
  camera.getViewMatrix(true)
  expect(f.mesh.getLOD(camera)).toBe(f.mesh)
  camera.position.z = -60
  camera.getViewMatrix(true)
  expect(f.mesh.getLOD(camera)).toBeNull()
  expect(f.mesh.isDisposed()).toBe(false)
  camera.position.z = -20
  camera.getViewMatrix(true)
  expect(f.mesh.getLOD(camera)).toBe(f.mesh)
})

test('instances use the source LOD with their own distance', () => {
  const f = feature('cube')
  featureLOD(f)
  f.mesh.computeWorldMatrix(true)
  const instance = f.mesh.createInstance('far instance')
  instance.position.z = 120
  instance.computeWorldMatrix(true)
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -20), scene)
  camera.getViewMatrix(true)
  expect(f.mesh.getLOD(camera)).toBe(f.mesh)
  expect(instance.getLOD(camera)).toBeNull()
})
