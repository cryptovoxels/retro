import { afterEach, expect, test, vi } from 'vitest'
import earcut from 'earcut'
import RAPIER from '@dimforge/rapier3d-compat'
import Islands, { Island } from '../src/terrain/islands'
import { packGround } from '../common/voxels/ground-bytes'
import { groundMesh } from '../src/monoworker/ground-mesh'
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
  expect(world.castRay(new RAPIER.Ray({ x: 6.25, y: -2, z: 6.25 }, { x: 1, y: 0, z: 0 }), 5, true)?.timeOfImpact).toBeCloseTo(1.75, 4)
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
            [0.301, -0.001],
            [0.299, 0.101],
            [0, 0.1],
          ],
          [
            [0.4, 0],
            [0.5, 0],
            [0.451, 0.099],
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
    expect(positions[i * 3] * 2).toBe(Math.round(positions[i * 3] * 2))
    expect(positions[i * 3 + 2] * 2).toBe(Math.round(positions[i * 3 + 2] * 2))
    if (Math.abs(normals[i * 3 + 1]) > 0.5) {
      expect(uvs[i * 2]).toBeCloseTo(positions[i * 3] * 2)
      expect(uvs[i * 2 + 1]).toBeCloseTo(positions[i * 3 + 2] * 2)
    } else {
      expect(uvs[i * 2 + 1]).toBeCloseTo((positions[i * 3 + 1] + island.mesh.position.y) * 2)
    }
  }
})

test('terrain collision follows a raised pad and leaves room underneath a creek crossing', async () => {
  await initPhysics()
  const { groundMesh } = await import('../src/monoworker/ground-mesh')
  const { addTrimesh } = await import('../src/physics/world')
  const field = Buffer.alloc(16 + 2 * 8, 255)
  field.writeInt32LE(0, 0)
  field.writeInt32LE(0, 4)
  field.writeInt32LE(2, 8)
  field.writeInt32LE(1, 12)
  for (let y = 0; y < 8; y++) field[16 + 2 * y] = 4
  field[17] = 5
  field[17 + 2 * 5] = 31
  const mesh = groundMesh(field)
  const key = 'test-terraced-crossing'
  try {
    addTrimesh(key, mesh.positions, mesh.indices, { x: 0, y: 0, z: 0 })
    const world = physics()!
    world.step()
    const hit = (x: number, y: number) => world.castRay(new RAPIER.Ray({ x, y, z: 0.25 }, { x: 0, y: -1, z: 0 }), 10, true)?.timeOfImpact
    expect(hit(0.25, 5)).toBeCloseTo(5 - 2.74)
    expect(hit(0.75, 5)).toBeCloseTo(5 - 1.74)
    expect(hit(0.75, 0.25)).toBeCloseTo(0.25 + 0.76)
  } finally {
    removeCollider(key)
  }
})

test('a saved street tile, its collider and its name start on the parcel voxel edge', async () => {
  await initPhysics()
  const pool = await import('../src/mono-pool')
  const bytes = Buffer.alloc(32, 255)
  ;[139, -1042, 1, 1].forEach((v, i) => bytes.writeInt32LE(v, i * 4))
  bytes[16] = 64
  const compute = vi.spyOn(pool, 'runCompute').mockResolvedValueOnce(groundMesh(bytes))
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  const islands = new Islands(scene)
  const road = { name: 'Blodgett St', x1: 0, z1: 0, x2: 0.5, z2: 0.5 }
  try {
    const island = await islands.add({
      id: 40,
      name: 'Texas',
      texture: '/textures/texas-ground.png',
      ground: packGround(bytes),
      content: { origin: [139, 0, -1042], streets: [road] },
      geometry: {
        coordinates: [
          [
            [1.39, -10.42],
            [1.4, -10.42],
            [1.4, -10.41],
            [1.39, -10.41],
            [1.39, -10.42],
          ],
        ],
      },
    } as any)
    const min = island.mesh.getBoundingInfo().boundingBox.minimumWorld
    expect([min.x, min.z]).toEqual([139.25, -1041.75])
    const world = physics()!
    world.step()
    for (const [x, z, inside] of [
      [139.26, -1041.74, true],
      [139.24, -1041.74, false],
      [139.26, -1041.76, false],
    ] as const) {
      expect(!!islands.streetAt(x, z)).toBe(inside)
      expect(!!world.castRay(new RAPIER.Ray({ x, y: 1, z }, { x: 0, y: -1, z: 0 }), 5, true)).toBe(inside)
    }
  } finally {
    compute.mockRestore()
    removeCollider('island-Texas')
  }
})
