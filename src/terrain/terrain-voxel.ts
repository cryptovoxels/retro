// ABOUTME: Voxel-based terrain generation using existing ao-mesher
// ABOUTME: Fills 64x64x64 chunks from island polygons, uses glass for water

import ndarray, { type NdArray } from 'ndarray'
import mesher from '../../common/voxels/mesher'
import { VoxelSize } from '../../common/voxels/constants'

const CHUNK_SIZE = 64
const LAND_MATERIAL = (1 << 15) + 10 // default solid
const WATER_MATERIAL = 2 // glass texture index (handled specially by ao-mesher)
const GROUND_HEIGHT = 2 // voxels (1m at 0.5m/voxel)
const WATER_HEIGHT = 1 // voxels (0.5m)

type Ring = [number, number][]
type AABB = { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export interface TerrainChunkInput {
  centerX: number
  centerZ: number
  islands: Ring[]
  ponds: AABB[]
  parcels: AABB[]
}

export interface TerrainMeshData {
  // Land mesh (opaque)
  landPositions: Float32Array
  landIndices: Uint32Array
  landNormals: Float32Array
  // Water mesh (glass)
  waterPositions: Float32Array
  waterIndices: Uint32Array
  waterNormals: Float32Array
}

// Point in polygon using ray casting
function pointInPolygon(x: number, z: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      zi = ring[i][1]
    const xj = ring[j][0],
      zj = ring[j][1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// Check if point is inside any island
function isLand(x: number, z: number, islands: Ring[]): boolean {
  for (const island of islands) {
    if (pointInPolygon(x, z, island)) return true
  }
  return false
}

// Fill voxel array for terrain chunk
function fillTerrainVoxels(input: TerrainChunkInput): NdArray<Uint16Array> {
  const { centerX, centerZ, islands, ponds } = input
  const half = (CHUNK_SIZE * VoxelSize) / 2

  const field = ndarray(new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE), [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE])

  for (let vx = 0; vx < CHUNK_SIZE; vx++) {
    for (let vz = 0; vz < CHUNK_SIZE; vz++) {
      const worldX = centerX - half + vx * VoxelSize
      const worldZ = centerZ - half + vz * VoxelSize

      const land = isLand(worldX, worldZ, islands)

      for (let vy = 0; vy < CHUNK_SIZE; vy++) {
        let material = 0

        if (land) {
          // Land - solid ground
          if (vy < GROUND_HEIGHT) {
            material = LAND_MATERIAL
          }
        } else {
          // Water - glass at surface level
          if (vy < WATER_HEIGHT) {
            material = WATER_MATERIAL
          }
        }

        // Carve ponds
        for (const pond of ponds) {
          const worldY = vy * VoxelSize
          if (worldX >= pond.x1 && worldX <= pond.x2 && worldY >= pond.y1 && worldY <= pond.y2 && worldZ >= pond.z1 && worldZ <= pond.z2) {
            material = WATER_MATERIAL // ponds become water
            break
          }
        }

        field.set(vx, vy, vz, material)
      }
    }
  }

  return field
}

// Offset positions array by world center
function offsetPositions(positions: Float32Array, centerX: number, centerZ: number): Float32Array {
  const half = (CHUNK_SIZE * VoxelSize) / 2
  const out = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] + centerX - half
    out[i + 1] = positions[i + 1]
    out[i + 2] = positions[i + 2] + centerZ - half
  }
  return out
}

// Generate terrain mesh from input
export function generateTerrainChunk(input: TerrainChunkInput): TerrainMeshData | null {
  const field = fillTerrainVoxels(input)
  const meshData = mesher([CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE], field, LAND_MATERIAL)

  const hasLand = meshData.colliderPositions.length > 0
  const hasWater = meshData.glassPositions.length > 0

  if (!hasLand && !hasWater) return null

  return {
    landPositions: offsetPositions(meshData.colliderPositions, input.centerX, input.centerZ),
    landIndices: meshData.colliderIndices,
    landNormals: meshData.colliderNormals,
    waterPositions: offsetPositions(meshData.glassPositions, input.centerX, input.centerZ),
    waterIndices: meshData.glassIndices,
    waterNormals: meshData.glassNormals,
  }
}
