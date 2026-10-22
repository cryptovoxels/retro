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

test('island tops and walls share world-aligned 50cm UVs regardless of island dimensions', () => {
  ;(globalThis as any).earcut = earcut
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  const island = new Island(
    { scene } as any,
    {
      id: 40,
      name: 'Scarcity',
      geometry: {
        coordinates: [
          [
            [0, 0],
            [0.3, 0],
            [0.3, 0.1],
            [0, 0.1],
          ],
          [
            [0.4, 0],
            [0.5, 0],
            [0.45, 0.1],
          ],
        ],
      },
      lakes_geometry_json: {
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
    } as any,
  )
  const positions = island.mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)!
  const normals = island.mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind)!
  const uvs = island.mesh.getVerticesData(BABYLON.VertexBuffer.UVKind)!
  const indices = island.mesh.getIndices()!
  for (let i = 0; i < indices.length; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[i + edge]
      const b = indices[i + ((edge + 1) % 3)]
      const metres = Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2])
      const repeats = Math.hypot(uvs[a * 2] - uvs[b * 2], uvs[a * 2 + 1] - uvs[b * 2 + 1])
      expect(repeats).toBeCloseTo(metres * 2, 4)
    }
  }
  for (let i = 0; i < positions.length / 3; i++) {
    if (Math.abs(normals[i * 3 + 1]) > 0.5) {
      expect(uvs[i * 2]).toBeCloseTo(positions[i * 3] * 2)
      expect(uvs[i * 2 + 1]).toBeCloseTo(positions[i * 3 + 2] * 2)
    } else {
      expect(uvs[i * 2 + 1]).toBeCloseTo((positions[i * 3 + 1] + island.mesh.position.y) * 2)
    }
  }
})
