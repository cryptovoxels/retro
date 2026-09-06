import type { MeshBuf } from '../mesh/buf'

export type VoxData = MeshBuf & {
  size: number[]
  colliderPositions?: number[]
  colliderIndices?: number[]
}

export type VoxPaletteColor = { r: number; g: number; b: number; a?: number }
export type VoxVoxel = { x: number; y: number; z: number; colorIndex: number }
export type ParsedVox = {
  sizes: { x: number; y: number; z: number }[]
  models: VoxVoxel[][]
  palette: VoxPaletteColor[]
}
