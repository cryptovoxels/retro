import { vec3 } from 'wgpu-matrix'
import { defaultColors } from '../../common/content/blocks'
import { getBufferFromVoxels, getFieldShape } from '../../common/voxels/helpers'
import { brickify, type Brickified, VOX_RES } from './bricks'
import { Bounds } from './math/bounds'
import { VoxelData } from './math/voxeldata'
import { nearestPaletteIndexFromRgb } from './palette'

const AIR = 0xff
const GRID_SPACING_10CM = 80

export const LOD_VOXEL_SCALE = [0.1, 0.2, 0.4, 0.8] as const
export const LOD_CHUNK_WORLD = LOD_VOXEL_SCALE.map((s) => VOX_RES * s)
export const LOD_Y_LAYERS = [8, 4, 2, 1] as const
export const LOD_COUNT = 4

const TERRAIN_SHAPE = vec3.create(VOX_RES, VOX_RES, VOX_RES)

let groundClr = 0
let gridClr = 0
let colorsReady = false

function ensureColors() {
  if (colorsReady) return
  groundClr = nearestPaletteIndexFromRgb(1, 1, 1)
  gridClr = nearestPaletteIndexFromRgb(0.2, 0.2, 0.2)
  colorsReady = true
}

function hexToRgb(hex: string) {
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  return {
    r: Number.parseInt(h.slice(0, 2), 16) / 255,
    g: Number.parseInt(h.slice(2, 4), 16) / 255,
    b: Number.parseInt(h.slice(4, 6), 16) / 255,
  }
}

function blockToPalette(value: number, colors: string[]): number {
  if (value === 0) return 0
  const tint = Math.floor(value / 32) % 8
  const hex = colors[tint] || defaultColors[tint] || '#ffffff'
  const rgb = hexToRgb(hex)
  return nearestPaletteIndexFromRgb(rgb.r, rgb.g, rgb.b)
}

function euclidMod(n: number, m: number) {
  return ((n % m) + m) % m
}

/** Dense palette-indexed field at a given meter scale. 0xff = air. */
export type FieldMip = {
  scale: number
  ox: number
  oy: number
  oz: number
  sx: number
  sy: number
  sz: number
  words: Uint32Array
}

export type ParcelMips = {
  id: number
  originM: [number, number, number]
  /** world AABB in meters */
  minM: [number, number, number]
  maxM: [number, number, number]
  mips: FieldMip[]
  features: Array<{
    type: string
    position?: number[]
    rotation?: number[]
    scale?: number[]
    url?: unknown
  }> | null
}

function setByte(words: Uint32Array, idx: number, v: number) {
  const wi = idx >> 2
  const sh = (idx & 3) * 8
  words[wi] = (words[wi] & ~(0xff << sh)) | ((v & 0xff) << sh)
}

function getByte(words: Uint32Array, idx: number) {
  return (words[idx >> 2] >> ((idx & 3) * 8)) & 0xff
}

/** Upscale 50cm retro field -> 10cm engine field (quarantine edge). */
export function upscaleTo10cm(shape: [number, number, number], get: (x: number, y: number, z: number) => number, colors: string[], originM: [number, number, number]): FieldMip {
  const [fx, fy, fz] = shape
  const sx = fx * 5
  const sy = fy * 5
  const sz = fz * 5
  const words = new Uint32Array(Math.ceil((sx * sy * sz) / 4))
  words.fill(0xffff_ffff)
  for (let z = 0; z < fz; z++) {
    for (let y = 0; y < fy; y++) {
      for (let x = 0; x < fx; x++) {
        const v = get(x, y, z)
        if (!v) continue
        const clr = blockToPalette(v, colors)
        if (!clr) continue
        for (let dz = 0; dz < 5; dz++) {
          for (let dy = 0; dy < 5; dy++) {
            for (let dx = 0; dx < 5; dx++) {
              const ix = x * 5 + dx
              const iy = y * 5 + dy
              const iz = z * 5 + dz
              setByte(words, ix + iy * sx + iz * sx * sy, clr)
            }
          }
        }
      }
    }
  }
  return { scale: 0.1, ox: originM[0], oy: originM[1], oz: originM[2], sx, sy, sz, words }
}

/** 2x2x2 downsample: solid if any child solid, most common child color. */
export function downsampleMip(src: FieldMip): FieldMip {
  const sx = Math.max(1, Math.ceil(src.sx / 2))
  const sy = Math.max(1, Math.ceil(src.sy / 2))
  const sz = Math.max(1, Math.ceil(src.sz / 2))
  const words = new Uint32Array(Math.ceil((sx * sy * sz) / 4))
  words.fill(0xffff_ffff)
  const counts = new Map<number, number>()
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        counts.clear()
        let best = 0
        let bestN = 0
        for (let dz = 0; dz < 2; dz++) {
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const ix = x * 2 + dx
              const iy = y * 2 + dy
              const iz = z * 2 + dz
              if (ix >= src.sx || iy >= src.sy || iz >= src.sz) continue
              const v = getByte(src.words, ix + iy * src.sx + iz * src.sx * src.sy)
              if (v === AIR) continue
              const n = (counts.get(v) || 0) + 1
              counts.set(v, n)
              if (n > bestN) {
                bestN = n
                best = v
              }
            }
          }
        }
        if (best) setByte(words, x + y * sx + z * sx * sy, best)
      }
    }
  }
  return { scale: src.scale * 2, ox: src.ox, oy: src.oy, oz: src.oz, sx, sy, sz, words }
}

export function buildParcelMips(
  id: number,
  originM: [number, number, number],
  // parcel bounds in 10cm voxel indices (retro Parcel.bounds)
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
  voxels: string,
  palette: string[] | undefined,
  features: ParcelMips['features'],
): ParcelMips | null {
  const [ox, oy, oz] = originM
  const mx = (boundsMax[0] - boundsMin[0]) / 10
  const my = (boundsMax[1] - boundsMin[1]) / 10
  const mz = (boundsMax[2] - boundsMin[2]) / 10
  const fieldShape = getFieldShape({ x1: ox, y1: oy, z1: oz, x2: ox + mx, y2: oy + my, z2: oz + mz })
  if (fieldShape[0] <= 0 || fieldShape[1] <= 0 || fieldShape[2] <= 0) return null
  const buf = getBufferFromVoxels({ fieldShape, voxels })
  if (!buf) return null
  const colors = (palette && palette.length ? palette : defaultColors).map((c, i) => c || defaultColors[i] || '#ffffff')
  const mip0 = upscaleTo10cm([fieldShape[0], fieldShape[1], fieldShape[2]], (x, y, z) => buf.get(x, y, z), colors, originM)
  const mips = [mip0]
  for (let i = 1; i < LOD_COUNT; i++) mips.push(downsampleMip(mips[i - 1]))
  return {
    id,
    originM,
    minM: [boundsMin[0] / 10, boundsMin[1] / 10, boundsMin[2] / 10],
    maxM: [boundsMax[0] / 10, boundsMax[1] / 10, boundsMax[2] / 10],
    mips,
    features,
  }
}

export type BakedProp = {
  /** dense words, 0xff air, shape sx*sy*sz */
  words: Uint32Array
  sx: number
  sy: number
  sz: number
  /** world position of voxel (0,0,0) in meters */
  wx: number
  wy: number
  wz: number
  /** voxel size in meters (usually 0.1) */
  scale: number
}

function sampleMip(mip: FieldMip, mx: number, my: number, mz: number): number {
  const ix = Math.floor((mx - mip.ox) / mip.scale)
  const iy = Math.floor((my - mip.oy) / mip.scale)
  const iz = Math.floor((mz - mip.oz) / mip.scale)
  if (ix < 0 || iy < 0 || iz < 0 || ix >= mip.sx || iy >= mip.sy || iz >= mip.sz) return AIR
  return getByte(mip.words, ix + iy * mip.sx + iz * mip.sx * mip.sy)
}

/** Generate dense 64^3 chunk words at LOD, then brickify. */
export function generateChunkBrickified(lod: number, cx: number, cy: number, cz: number, parcels: ParcelMips[], props: BakedProp[]): Brickified {
  ensureColors()
  const chunk = new VoxelData(TERRAIN_SHAPE)
  chunk.words.fill(0xffff_ffff)
  const scale = LOD_VOXEL_SCALE[lod]
  const world = LOD_CHUNK_WORLD[lod]
  const worldMinX = cx * world
  const worldMinY = cy * world
  const worldMinZ = cz * world

  if (cy === 0) {
    for (let z = 0; z < VOX_RES; z++) {
      for (let x = 0; x < VOX_RES; x++) {
        const wx10 = Math.floor((worldMinX + x * scale) / 0.1)
        const wz10 = Math.floor((worldMinZ + z * scale) / 0.1)
        const line = euclidMod(wx10, GRID_SPACING_10CM) === 0 || euclidMod(wz10, GRID_SPACING_10CM) === 0
        const voxelIndex = x + z * VOX_RES * VOX_RES
        const wordIndex = voxelIndex >>> 2
        const shift = (voxelIndex & 3) * 8
        chunk.words[wordIndex] = (chunk.words[wordIndex] & ~(0xff << shift)) | ((line ? gridClr : groundClr) << shift)
      }
    }
  }

  const chunkBounds = Bounds.create(worldMinX, worldMinY, worldMinZ, worldMinX + world, worldMinY + world, worldMinZ + world)

  for (const parcel of parcels) {
    if (parcel.maxM[0] <= chunkBounds.x1 || parcel.minM[0] >= chunkBounds.x2) continue
    if (parcel.maxM[1] <= chunkBounds.y1 || parcel.minM[1] >= chunkBounds.y2) continue
    if (parcel.maxM[2] <= chunkBounds.z1 || parcel.minM[2] >= chunkBounds.z2) continue
    const mip = parcel.mips[lod] || parcel.mips[parcel.mips.length - 1]
    const p = vec3.create()
    for (let z = 0; z < VOX_RES; z++) {
      for (let y = 0; y < VOX_RES; y++) {
        for (let x = 0; x < VOX_RES; x++) {
          const mx = worldMinX + (x + 0.5) * scale
          const my = worldMinY + (y + 0.5) * scale
          const mz = worldMinZ + (z + 0.5) * scale
          const v = sampleMip(mip, mx, my, mz)
          if (v === AIR) continue
          vec3.set(x, y, z, p)
          chunk.set(p, v)
        }
      }
    }
  }

  // bake props into chunk (all LODs)
  for (const prop of props) {
    const pScale = prop.scale
    for (let z = 0; z < prop.sz; z++) {
      for (let y = 0; y < prop.sy; y++) {
        for (let x = 0; x < prop.sx; x++) {
          const v = getByte(prop.words, x + y * prop.sx + z * prop.sx * prop.sy)
          if (v === AIR) continue
          const mx = prop.wx + (x + 0.5) * pScale
          const my = prop.wy + (y + 0.5) * pScale
          const mz = prop.wz + (z + 0.5) * pScale
          if (mx < chunkBounds.x1 || my < chunkBounds.y1 || mz < chunkBounds.z1) continue
          if (mx >= chunkBounds.x2 || my >= chunkBounds.y2 || mz >= chunkBounds.z2) continue
          const ix = Math.floor((mx - worldMinX) / scale)
          const iy = Math.floor((my - worldMinY) / scale)
          const iz = Math.floor((mz - worldMinZ) / scale)
          if (ix < 0 || iy < 0 || iz < 0 || ix >= VOX_RES || iy >= VOX_RES || iz >= VOX_RES) continue
          chunk.set(vec3.fromValues(ix, iy, iz), v)
        }
      }
    }
  }

  return brickify(chunk.words)
}

/** Parse a .vox buffer into a BakedProp at world origin (voxel 0,0,0). */
export async function bakeVoxBuffer(buffer: ArrayBuffer, wx: number, wy: number, wz: number, scale = 0.1): Promise<BakedProp | null> {
  const VoxReader = require('@sh-dave/format-vox').VoxReader
  const vox: any = await new Promise((resolve, reject) => {
    VoxReader.read(buffer, (data: any, err: string | null) => {
      if (err || !data?.models?.[0]) reject(err || 'bad vox')
      else resolve(data)
    })
  })
  const size = vox.sizes[0] as { x: number; y: number; z: number }
  const words = new Uint32Array(Math.ceil((size.x * size.y * size.z) / 4))
  words.fill(0xffff_ffff)
  const palette = vox.palette as { r: number; g: number; b: number; a: number }[]
  const model = vox.models[0] as { x: number; y: number; z: number; colorIndex: number }[]
  for (const row of model) {
    const c = palette[row.colorIndex]
    if (!c || c.a < 10) continue
    const clr = nearestPaletteIndexFromRgb(c.r / 255, c.g / 255, c.b / 255)
    const y = size.y - 1 - row.y
    setByte(words, row.x + y * size.x + row.z * size.x * size.y, clr)
  }
  return { words, sx: size.x, sy: size.y, sz: size.z, wx, wy, wz, scale }
}
