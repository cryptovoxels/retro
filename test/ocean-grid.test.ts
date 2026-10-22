import { afterEach, expect, test } from 'vitest'
import { Ocean } from '../src/terrain/ocean'

let engine: BABYLON.NullEngine
let scene: BABYLON.Scene

afterEach(() => {
  scene?.dispose()
  engine?.dispose()
})

function oceanGrid() {
  engine = new BABYLON.NullEngine()
  scene = new BABYLON.Scene(engine)
  const ocean: any = Object.create(Ocean.prototype)
  ocean.size = 48
  ocean.halfSize = 24
  ocean.scene = scene
  ocean.mesh = BABYLON.MeshBuilder.CreateGround('template', { width: 48, height: 48 }, scene)
  ocean.customMeshes = new Map()
  ocean.instances = new Map()
  ocean.islandBoundsCache = new Map()
  ocean.islands = [
    {
      id: 1,
      geometry: {
        coordinates: [
          [
            [0.04, 0.04],
            [0.12, 0.04],
            [0.12, 0.12],
            [0.04, 0.12],
          ],
        ],
      },
      lakes_geometry_json: {
        coordinates: [
          [
            [
              [0.06, 0.06],
              [0.08, 0.06],
              [0.08, 0.08],
              [0.06, 0.08],
            ],
          ],
        ],
      },
    },
    {
      id: 2,
      geometry: {
        coordinates: [
          [
            [0.1, 0.04],
            [0.16, 0.04],
            [0.16, 0.12],
            [0.1, 0.12],
          ],
        ],
      },
    },
  ]
  // Database outlines can drift off-grid. Both land and lakes must snap back.
  for (const island of ocean.islands) {
    for (const ring of island.geometry.coordinates) {
      for (const point of ring) {
        point[0] += 0.0013
        point[1] -= 0.0011
      }
    }
    for (const polygon of island.lakes_geometry_json?.coordinates || []) {
      for (const point of polygon[0]) {
        point[0] -= 0.0012
        point[1] += 0.0014
      }
    }
  }
  return ocean
}

test('50cm water cells exclude overlapping islands, preserve lakes, and never overlap', () => {
  const ocean = oceanGrid()
  ocean.processChunk({ worldX: 0, worldZ: 0, gridX: 0, gridZ: 0 }, { x: 24, z: 24 }, '0_0')
  const meshes = ocean.customMeshes.get('0_0')
  expect(meshes).toHaveLength(1)
  const mesh = meshes[0]
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)
  const indices = mesh.getIndices()
  let area = 0
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((n: number) => ({ x: positions[n * 3] + 24, z: positions[n * 3 + 2] + 24 }))
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2
  }
  // 12m x 8m union of land, with a 2m x 2m lake.
  expect(area).toBe(48 * 48 - 12 * 8 + 2 * 2)
  for (const value of positions) expect(value * 2).toBe(Math.round(value * 2))
  mesh.computeWorldMatrix(true)
  const hits = (x: number, z: number) => new BABYLON.Ray(new BABYLON.Vector3(x, 5, z), BABYLON.Vector3.Down()).intersectsMesh(mesh).hit
  expect(hits(5, 5)).toBe(false)
  expect(hits(11, 5)).toBe(false)
  expect(hits(7, 7)).toBe(true)
  expect(hits(20, 20)).toBe(true)
})

test('clipped water uses the same texture orientation and scale as instanced ground', () => {
  const ocean = oceanGrid()
  const positions = ocean.mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)
  const uvs = ocean.mesh.getVerticesData(BABYLON.VertexBuffer.UVKind)
  expect(ocean.generateUVCoordinates(positions, { worldX: 0, worldZ: 0 }, { x: 24, z: 24 })).toEqual(Array.from(uvs))
  const normals: number[] = []
  const data = ocean.generateWorldVertices([
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 0, z: 1 },
  ])
  BABYLON.VertexData.ComputeNormals(data.vertices, data.indices, normals)
  expect(normals[1]).toBeGreaterThan(0)
})
