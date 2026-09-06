import type { NdArray } from 'ndarray'
import { meshLegacyField } from '../../src/monoworker/mesh'
import { VoxelSize } from './constants'

export { VoxelSize }

type MeshData = {
  opaquePositions: Float32Array
  opaqueIndices: Uint32Array
  opaqueNormals: Float32Array
  ambientOcclusion: Float32Array
  opaqueTextureIndices: Float32Array
  glassPositions: Float32Array
  glassIndices: Uint32Array
  glassNormals: Float32Array
}

export default function mesher(shape: [number, number, number], field: NdArray<Uint16Array>, _solidMaterialId?: number): MeshData {
  const out = meshLegacyField(field.data, shape, field.stride, field.offset)
  const opaque = out.opaque
  const glass = out.glass
  const vertCount = opaque.positions.length / 3
  return {
    opaquePositions: opaque.positions,
    opaqueIndices: opaque.indices,
    opaqueNormals: opaque.normals,
    ambientOcclusion: new Float32Array(vertCount).fill(1),
    opaqueTextureIndices: opaque.colorIndices,
    glassPositions: glass?.positions ?? new Float32Array(0),
    glassIndices: glass?.indices ?? new Uint32Array(0),
    glassNormals: glass?.normals ?? new Float32Array(0),
  }
}

export const transferableItemsForMesh = (md: MeshData) => [
  md.glassIndices.buffer,
  md.glassPositions.buffer,
  md.glassNormals.buffer,
  md.ambientOcclusion.buffer,
  md.opaqueIndices.buffer,
  md.opaquePositions.buffer,
  md.opaqueNormals.buffer,
  md.opaqueTextureIndices.buffer,
]
