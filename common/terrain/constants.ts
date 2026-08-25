import { VoxelSize } from '../voxels/constants'
import { getBlockId } from '../content/blocks'

export const CHUNK_VOXELS = 64
export const CHUNK_WORLD = CHUNK_VOXELS * VoxelSize // 32
export const CHUNK_HEIGHT_USED = 16

// world y of voxel y=0 (sea floor sits here)
export const WORLD_Y0 = -6

export const TILE = {
  AIR: 0,
  SAND: 1,
  DIRT: 2,
  GRASS: 3,
  WATER: 4,
} as const

export type TileId = (typeof TILE)[keyof typeof TILE]

// expand packed uint8 tile id to parcel block value (opaque = (1<<15)+layer+tint*32, glass = 2+tint*32)
export function toMesherId(tile: number): number {
  switch (tile) {
    case TILE.SAND:
      return getBlockId(2, 7) // white-square, cream
    case TILE.DIRT:
      return getBlockId(13, 1) // blob, grey
    case TILE.GRASS:
      return getBlockId(9, 4) // white-square, green
    case TILE.WATER:
      return getBlockId(1, 4) // glass, blue
    default:
      return 0
  }
}

export function isSolid(tile: number): boolean {
  return tile === TILE.SAND || tile === TILE.DIRT || tile === TILE.GRASS
}

export function worldToChunk(wx: number, wz: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(wx / CHUNK_WORLD),
    cz: Math.floor(wz / CHUNK_WORLD),
  }
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx}_${cy}_${cz}`
}

// island top / water surface in voxel y (relative to WORLD_Y0)
export const ISLAND_TOP_VOXEL = Math.floor((0.75 - WORLD_Y0) / VoxelSize) // 13
export const WATER_TOP_VOXEL = Math.floor((0 - WORLD_Y0) / VoxelSize) // 12
