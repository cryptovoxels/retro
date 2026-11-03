import { expect, test } from 'vitest'
import { mirrorTexture } from '../src/utils/mirror'

test('reflection membership follows mesh lifetime and material changes', async () => {
  const engine = new BABYLON.NullEngine()
  const scene = new BABYLON.Scene(engine)
  const island = new BABYLON.Mesh('island/test', scene)
  const mirror = mirrorTexture(scene, 0)
  try {
    const voxel = new BABYLON.Mesh('voxelizer/opaque-1', scene)
    const image = new BABYLON.Mesh('feature/image', scene)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mirror.renderList?.map((mesh) => mesh.name)).toEqual([island.name, voxel.name])
    expect(mirror.renderListPredicate).toBeUndefined()

    const material = new BABYLON.StandardMaterial('reflective', scene)
    material.reflectionTexture = mirror
    island.material = material
    expect(mirror.renderList?.map((mesh) => mesh.name)).toEqual([voxel.name])
    island.material = null
    expect(mirror.renderList?.map((mesh) => mesh.name)).toEqual([voxel.name, island.name])

    voxel.dispose()
    expect(mirror.renderList?.map((mesh) => mesh.name)).toEqual([island.name])
    expect(mirror.renderList).not.toContain(image)
    mirror.dispose()
    expect(island.onMaterialChangedObservable.hasObservers()).toBe(false)
    expect(scene.onNewMeshAddedObservable.hasObservers()).toBe(false)
    expect(scene.onMeshRemovedObservable.hasObservers()).toBe(false)
  } finally {
    scene.dispose()
    engine.dispose()
  }
})
