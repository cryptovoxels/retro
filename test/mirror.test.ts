import { afterEach, expect, test } from 'vitest'
import { mirrorTexture } from '../src/utils/mirror'

let engine: BABYLON.NullEngine

afterEach(() => engine?.dispose())

test('mirrors exclude their own consumers even when materials are assigned later', () => {
  engine = new BABYLON.NullEngine()
  const scene = new BABYLON.Scene(engine)
  const island = BABYLON.MeshBuilder.CreateBox('island/test', {}, scene)
  const sky = BABYLON.MeshBuilder.CreateBox('skybox', {}, scene)
  const voxels = BABYLON.MeshBuilder.CreateBox('voxelizer/opaque-test', {}, scene)
  const water = BABYLON.MeshBuilder.CreateBox('ocean', {}, scene)
  const mirror = mirrorTexture(scene, 0.74)
  const ocean = mirrorTexture(scene, 0)

  expect(mirror.renderListPredicate(island)).toBe(true)
  const material = new BABYLON.StandardMaterial('island', scene)
  material.reflectionTexture = mirror
  material.freeze()
  island.material = material

  expect(mirror.renderListPredicate(island)).toBe(false)
  expect(ocean.renderListPredicate(island)).toBe(true)
  expect(mirror.renderListPredicate(sky)).toBe(true)
  expect(mirror.renderListPredicate(voxels)).toBe(true)
  expect(mirror.renderListPredicate(water)).toBe(false)

  island.material = null
  expect(mirror.renderListPredicate(island)).toBe(true)
})
