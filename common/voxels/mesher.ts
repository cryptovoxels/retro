import * as createAOMesh from 'ao-mesher'
import type { NdArray } from 'ndarray'
import { oversizedField } from '../../common/voxels/helpers'
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

// The 0.25 is to make the boxes aligned on the 0, 0.5 and 1 in each
// dimension, makes picking easier (but it's kind of gross)
const fx = (x: number) => x - 0.25
const fy = (y: number) => y + 0.25
const fz = (z: number) => z - 0.25

// constants to point to the a, b, c points in the vertex data returned by createAOMesh
const a = 0
const ax = a
const ay = a + 1
const az = a + 2
const b = 8
const bx = b
const by = b + 1
const bz = b + 2
const c = 16
const cx = c
const cy = c + 1
const cz = c + 2

function computeNormal(pax: number, pay: number, paz: number, pbx: number, pby: number, pbz: number, pcx: number, pcy: number, pcz: number): [number, number, number] {
  const ux = pbx - pax
  const uy = pby - pay
  const uz = pbz - paz
  const vx = pcx - pax
  const vy = pcy - pay
  const vz = pcz - paz
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  return [nx / len, ny / len, nz / len]
}

export function setVoxelData(data: Uint8Array, i: number, positions: number[], normals: number[], indices: number[], indexCount: number) {
  const pax = fx(data[ax + i] * VoxelSize)
  const pay = fy(data[ay + i] * VoxelSize)
  const paz = fz(data[az + i] * VoxelSize)
  const pbx = fx(data[bx + i] * VoxelSize)
  const pby = fy(data[by + i] * VoxelSize)
  const pbz = fz(data[bz + i] * VoxelSize)
  const pcx = fx(data[cx + i] * VoxelSize)
  const pcy = fy(data[cy + i] * VoxelSize)
  const pcz = fz(data[cz + i] * VoxelSize)

  positions.push(pax, pay, paz)
  positions.push(pbx, pby, pbz)
  positions.push(pcx, pcy, pcz)

  const [nx, ny, nz] = computeNormal(pax, pay, paz, pbx, pby, pbz, pcx, pcy, pcz)
  normals.push(nx, ny, nz)
  normals.push(nx, ny, nz)
  normals.push(nx, ny, nz)

  indices.push(indexCount, indexCount + 2, indexCount + 1)

  return 3 // next count for index/element count
}

// @todo, the indices returned from the function doesnt deduplicate vertices, so check the vox-reader.ts for optimisation
export default function mesher(shape: [number, number, number], field: NdArray<Uint16Array>, solidMaterialId?: number): MeshData {
  const oversized = oversizedField(field, solidMaterialId)
  const vertData: Uint8Array | null = createAOMesh(oversized)

  const glassPositions: number[] = []
  const glassNormals: number[] = []
  const glassIndices: number[] = []
  let glassIndexCount = 0

  const ambientOcclusion: number[] = []
  const opaqueTextureIndices = []
  const opaquePositions: number[] = []
  const opaqueNormals: number[] = []
  const opaqueIndices: number[] = []
  let opaqueIndexCount = 0

  if (vertData) {
    for (let i = 0; i < vertData.length; i += 8 * 3) {
      const textureIndex = vertData[i + 7]
      // glass mesh
      if (textureIndex === 2) {
        glassIndexCount += setVoxelData(vertData, i, glassPositions, glassNormals, glassIndices, glassIndexCount)
        continue
      }
      opaqueIndexCount += setVoxelData(vertData, i, opaquePositions, opaqueNormals, opaqueIndices, opaqueIndexCount)
      opaqueTextureIndices.push(textureIndex, textureIndex, textureIndex)
      ambientOcclusion.push(vertData[a + i + 3], vertData[b + i + 3], vertData[c + i + 3])
    }
  } else {
    console.debug('createAOMesh returned null - corrupted or invalid voxel data')
  }

  return {
    opaquePositions: new Float32Array(opaquePositions),
    opaqueIndices: new Uint32Array(opaqueIndices),
    opaqueNormals: new Float32Array(opaqueNormals),
    ambientOcclusion: new Float32Array(ambientOcclusion),
    opaqueTextureIndices: new Float32Array(opaqueTextureIndices),
    glassPositions: new Float32Array(glassPositions),
    glassIndices: new Uint32Array(glassIndices),
    glassNormals: new Float32Array(glassNormals),
  }
}

// Can be used for more efficient cross-thread transfer when calling postMessage()
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
