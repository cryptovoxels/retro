import { afterEach, expect, test, vi } from 'vitest'
import { createScene } from '../src/init/scene'

let engine: BABYLON.NullEngine

afterEach(() => engine?.dispose())

test('transparent sorting survives missing submesh bounds and still renders the queue', () => {
  engine = new BABYLON.NullEngine()
  const scene = createScene(engine as any)
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, -5), scene)
  const mesh = BABYLON.MeshBuilder.CreateBox('box', {}, scene)
  const missing = new BABYLON.SubMesh(0, 0, 4, 0, 6, mesh, undefined, false)
  const valid = new BABYLON.SubMesh(0, 4, 4, 6, 6, mesh)
  const bounds = valid.getBoundingInfo()
  const queue = new BABYLON.SmartArray<BABYLON.SubMesh>(2)
  queue.push(missing)
  queue.push(valid)
  const missingRender = vi.spyOn(missing, 'render').mockReturnValue(missing)
  const validRender = vi.spyOn(valid, 'render').mockReturnValue(valid)

  expect(missing.getBoundingInfo()).toBe(mesh.getBoundingInfo())
  expect(valid.getBoundingInfo()).toBe(bounds)
  for (let frame = 0; frame < 2; frame++) {
    expect(() => (BABYLON.RenderingGroup as any)._RenderSorted(queue, BABYLON.RenderingGroup.defaultTransparentSortCompare, camera, true, false)).not.toThrow()
  }
  expect(missingRender).toHaveBeenCalledTimes(2)
  expect(validRender).toHaveBeenCalledTimes(2)

  missing.refreshBoundingInfo()
  expect(missing.getBoundingInfo()).not.toBe(mesh.getBoundingInfo())
})
