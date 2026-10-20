import { afterEach, expect, test, vi } from 'vitest'
import earcut from 'earcut'
import RAPIER from '@dimforge/rapier3d-compat'
import { Island } from '../src/terrain/islands'
import { initPhysics, physics, removeCollider } from '../src/physics/world'

vi.mock('../src/materials', () => ({ createIslandMaterial: (scene: BABYLON.Scene) => new BABYLON.StandardMaterial('island-test', scene) }))

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene

afterEach(() => {
  removeCollider('island-Scarcity')
  scene?.dispose()
  engine?.dispose()
})

test('island collider preserves basement/lake holes, walls, surface height and shoreline', async () => {
  ;(globalThis as any).earcut = earcut
  await initPhysics()
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  const island = new Island(
    { scene } as any,
    {
      id: 1,
      name: 'Scarcity',
      geometry: {
        coordinates: [
          [
            [0, 0],
            [0.2, 0],
            [0.2, 0.1],
            [0.1, 0.2],
            [0, 0.2],
          ],
        ],
      },
      holes_geometry_json: {
        coordinates: [
          [
            [
              [0.04, 0.04],
              [0.08, 0.04],
              [0.08, 0.08],
              [0.04, 0.08],
            ],
          ],
        ],
      },
      lakes_geometry_json: {
        coordinates: [
          [
            [
              [0.12, 0.04],
              [0.16, 0.04],
              [0.16, 0.08],
              [0.12, 0.08],
            ],
          ],
        ],
      },
    } as any,
  )
  await island.render()
  const world = physics()!
  world.step()
  const down = (x: number, z: number) => world.castRay(new RAPIER.Ray({ x, y: 10, z }, { x: 0, y: -1, z: 0 }), 50, true)
  expect(down(2, 2)?.timeOfImpact).toBeCloseTo(9.26, 4)
  expect(down(6.25, 6.25)).toBeNull()
  expect(down(14.25, 6.25)).toBeNull()
  expect(down(19, 19)).toBeNull()
  expect(world.castRay(new RAPIER.Ray({ x: 6.25, y: -2, z: 6.25 }, { x: 1, y: 0, z: 0 }), 5, true)?.timeOfImpact).toBeCloseTo(2, 4)
  expect(world.castRay(new RAPIER.Ray({ x: 6.25, y: -2, z: 6.25 }, { x: 0, y: 1, z: 0 }), 10, true)).toBeNull()
  const count = world.colliders.len()
  await island.render()
  expect(world.colliders.len()).toBe(count)
})
