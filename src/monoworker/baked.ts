// @ts-ignore
import * as createAOMesh from 'ao-mesher'
import { getBufferFromVoxels, oversizedField } from '../../common/voxels/helpers'
import { setVoxelData } from '../../common/voxels/mesher'
import { computeNormals } from './math'
import type Parcel from '../parcel'

export type Job = { job: number }
export type BakedVoxelizerJobType = 'glass' | 'mesh'
export type ParcelVoxels = Pick<Parcel, 'fieldShape' | 'voxels' | 'island'>

export type BakedVoxelizedMesh = {
  positions: number[]
  indices: number[]
  normals: number[]
  uvs?: number[]
  uv2?: number[]
  faceMaterials?: number[]
}

type Material = number
type Vertex = [x: number, y: number, z: number]
type Quad = [Vertex, Vertex, Vertex, Vertex, Material]
type QuadList = Quad[]
type AdjacentGroupedQuads = Array<QuadList>

export type BakedVoxelizerWorkerInput = Job & {
  type: BakedVoxelizerJobType
  parcel: ParcelVoxels
}

export type BakedVoxelizerJobResult = Job & ({ glass: BakedVoxelizedMesh } | { mesh: BakedVoxelizedMesh })

export type BakedVoxelizerJobError = Job & { error: string }
export type BakedVoxelizerWorkerOutput = BakedVoxelizerJobResult | BakedVoxelizerJobError

const greedyV2 = require('../vendor/greedyV2')

const SMALLEST_QUAD_INDEX_CW_WINDING_ORDER = 0
const LARGEST_QUAD_INDEX_CW_WINDING_ORDER = 2

const potpack = require('../vendor/potpack')

const WHITE_BLOCK = (1 << 15) + 3

export function glass(parcel: ParcelVoxels): BakedVoxelizedMesh {
  const field = getBufferFromVoxels(parcel)
  if (!field) {
    throw new Error('No voxels field to mesh')
  }
  const materialId = parcel.island == 'Igloo' ? WHITE_BLOCK : null!
  const oversized = oversizedField(field, materialId)
  const vertData = createAOMesh(oversized)

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let indexCounter = 0

  for (let i = 0; i < vertData.length; i += 8 * 3) {
    // skip if opaque
    if (vertData[i + 7] !== 2) {
      continue
    }
    indexCounter += setVoxelData(vertData, i, positions, normals, indices, indexCounter)
  }
  return { positions, indices, normals }
}

function swatchedMesh(parcel: ParcelVoxels): BakedVoxelizedMesh {
  const field = getBufferFromVoxels(parcel)
  if (!field) {
    throw new Error('No voxels field to mesh')
  }

  // A swatch is one 2d sweep through an axis, with a group of quads in that swatch, that we should
  // consider for adjacency when packing (also called a mask in greedy).
  const swatches: AdjacentGroupedQuads = greedyV2(field)

  const positions: number[] = []
  const uvs: number[] = []
  const uv2: number[] = []
  const faceMaterials: number[] = []
  const indices: number[] = []
  let i = 0

  const fx = (x: number) => x * 0.5 - 0.25 + 0.5
  const fy = (y: number) => y * 0.5 + 0.25 + 0.5
  const fz = (z: number) => z * 0.5 - 0.25 + 0.5

  const packInfos: any[] = []

  const infinity = 999999
  let idx = 0

  swatches.forEach((quads) => {
    let minX = infinity
    let minY = infinity
    let minZ = infinity
    let maxX = -infinity
    let maxY = -infinity
    let maxZ = -infinity

    quads.forEach((quad) => {
      for (let i = 0; i < 4; i++) {
        // redundant type check to reassure typescript
        if (!Array.isArray(quad[i])) continue

        const v = quad[i] as Vertex

        minX = Math.min(minX, v[0])
        minY = Math.min(minY, v[1])
        minZ = Math.min(minZ, v[2])

        maxX = Math.max(maxX, v[0])
        maxY = Math.max(maxY, v[1])
        maxZ = Math.max(maxZ, v[2])
      }
    })

    // Indices to quads in this swatch
    const packIndices: number[] = []
    let width: number | null = null
    let height: number | null = null

    for (const quad of quads) {
      const j = i

      const [xMin, yMin, zMin] = quad[SMALLEST_QUAD_INDEX_CW_WINDING_ORDER] // will be minimum
      const [xMax, yMax, zMax] = quad[LARGEST_QUAD_INDEX_CW_WINDING_ORDER] // will be maximum

      let c = quad[4]

      if (xMin === xMax) {
        positions.push(fx(xMin), fy(yMin), fz(zMin))
        positions.push(fx(xMin), fy(yMax), fz(zMin))
        positions.push(fx(xMin), fy(yMax), fz(zMax))
        positions.push(fx(xMin), fy(yMin), fz(zMax))

        uvs.push(yMin, zMin)
        uvs.push(yMax, zMin)
        uvs.push(yMax, zMax)
        uvs.push(yMin, zMax)

        const mod = (u: number, v: number) => [(u - minY) / (maxY - minY), (v - minZ) / (maxZ - minZ)]

        uv2.push(...mod(yMin, zMin))
        uv2.push(...mod(yMax, zMin))
        uv2.push(...mod(yMax, zMax))
        uv2.push(...mod(yMin, zMax))

        width = maxY - minY // shapeVector.y
        height = maxZ - minZ // shapeVector.z

        packIndices.push(idx)
      } else if (yMin === yMax) {
        positions.push(fx(xMin), fy(yMin), fz(zMin))
        positions.push(fx(xMax), fy(yMin), fz(zMin))
        positions.push(fx(xMax), fy(yMin), fz(zMax))
        positions.push(fx(xMin), fy(yMin), fz(zMax))

        uvs.push(xMin, zMin)
        uvs.push(xMax, zMin)
        uvs.push(xMax, zMax)
        uvs.push(xMin, zMax)

        const mod = (u: number, v: number) => [(u - minX) / (maxX - minX), (v - minZ) / (maxZ - minZ)]

        uv2.push(...mod(xMin, zMin))
        uv2.push(...mod(xMax, zMin))
        uv2.push(...mod(xMax, zMax))
        uv2.push(...mod(xMin, zMax))

        width = maxX - minX // shapeVector.x
        height = maxZ - minZ // shapeVector.z

        packIndices.push(idx)
      } else {
        positions.push(fx(xMin), fy(yMin), fz(zMin))
        positions.push(fx(xMax), fy(yMin), fz(zMin))
        positions.push(fx(xMax), fy(yMax), fz(zMin))
        positions.push(fx(xMin), fy(yMax), fz(zMin))

        uvs.push(xMin, yMin)
        uvs.push(xMax, yMin)
        uvs.push(xMax, yMax)
        uvs.push(xMin, yMax)

        const mod = (u: number, v: number) => [(u - minX) / (maxX - minX), (v - minY) / (maxY - minY)]

        uv2.push(...mod(xMin, yMin))
        uv2.push(...mod(xMax, yMin))
        uv2.push(...mod(xMax, yMax))
        uv2.push(...mod(xMin, yMax))

        packIndices.push(idx)

        width = maxX - minX // shapeVector.x
        height = maxY - minY // shapeVector.y
      }

      // >0 is front face ,<0 is back face
      if (c > 0) {
        indices.push(j + 0, j + 1, j + 2)
        indices.push(j + 0, j + 2, j + 3)
      } else {
        indices.push(j + 0, j + 2, j + 1)
        indices.push(j + 0, j + 3, j + 2)
      }

      c = Math.abs(c)
      faceMaterials.push(c, c, c, c)

      i += 4
      idx++
    }
    if (width !== null && height !== null) {
      packInfos.push({ w: width, h: height, packIndices })
    }
  })

  const packedInfo = potpack(packInfos)
  const margin = 0.05

  packInfos.forEach((p: { packIndices: number[]; w: number; h: number; x: number; y: number }) => {
    p.packIndices.forEach((idx) => {
      for (let i = idx * 8; i < idx * 8 + 8; i += 2) {
        uv2[i + 0] = (p.w * (1 - margin - margin) * (margin + uv2[i + 0]) + p.x!) / packedInfo.w
        uv2[i + 1] = (p.h * (1 - margin - margin) * (margin + uv2[i + 1]) + p.y!) / packedInfo.h
      }
    })
  })

  const normals: number[] = computeNormals(positions, indices)

  return { positions, indices, normals, uvs, uv2, faceMaterials }
}

export async function processJob(job: number, type: BakedVoxelizerJobType, parcel: ParcelVoxels): Promise<BakedVoxelizerWorkerOutput> {
  try {
    switch (type) {
      case 'glass':
        return { job, glass: glass(parcel) }
      case 'mesh':
        return { job, mesh: swatchedMesh(parcel) }
      default:
        const _never: never = type
        throw new Error(`unknown job type ${type}`)
    }
  } catch (error: any) {
    console.error(error)
    return { job, error: error.message }
  }
}
