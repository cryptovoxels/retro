import { vec3, utils, type Vec3, type Vec3Arg } from 'wgpu-matrix'
import { defaultColors } from '../../common/content/blocks'
import { getBufferFromVoxels, getFieldShape } from '../../common/voxels/helpers'
import { Bounds } from './math/bounds'
import { VoxelData } from './math/voxeldata'
import { nearestPaletteIndexFromRgb } from './palette'
import { ParcelMap, parseParcelRecord, type Parcel, type ParcelContent } from './parcel'

const MAT4_F32_SIZE = 16 * Float32Array.BYTES_PER_ELEMENT
const VEC4_U32_SIZE = 4 * Uint32Array.BYTES_PER_ELEMENT
const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment

/** Byte offsets for terrain section of the shared uniform buffer (after viewInv + res/time). */
export const UNIFORM_GRID_ANCHOR_OFFSET = alignTo(MAT4_F32_SIZE + VEC4_U32_SIZE, 16)
export const UNIFORM_TERRAIN_PARAMS_OFFSET = UNIFORM_GRID_ANCHOR_OFFSET + VEC4_U32_SIZE
export const UNIFORM_BUFFER_SIZE = alignTo(UNIFORM_TERRAIN_PARAMS_OFFSET + VEC4_U32_SIZE, 16)

export const VOX_RES = 64
const VOXELS_PER_CHUNK = VOX_RES ** 3
export const VOXEL_WORDS_PER_CHUNK = VOXELS_PER_CHUNK / 4
const TERRAIN_CHUNK_SHAPE = vec3.create(VOX_RES, VOX_RES, VOX_RES)
const VOXEL_WORLD_SCALE = 0.1
export const TERRAIN_CHUNK_WORLD = VOX_RES * VOXEL_WORLD_SCALE

/** Retro field voxel is 50cm; raycast voxel is 10cm. */
const FIELD_UPSCALE = 5

/** dev serves the bundle off a different origin than the api (same trick as src/parcel.ts) */
export const api = (path: string) => (process.env.NODE_ENV !== 'production' ? (process.env.ASSET_PATH || '') + path : path)

const MACRO_RES = 32
const MACRO_CELL_WORLD = 8
const MACRO_CELL_COUNT = MACRO_RES ** 3
const MAX_CHUNKS_PER_MACRO = 8
const MACRO_INV_CELL_WORLD = 1 / MACRO_CELL_WORLD

const TERRAIN_RADIUS_CHUNKS = 2
const TERRAIN_Y_LAYERS = 4
const TERRAIN_STREAM_THRESHOLD_CHUNKS = 1
export const MAX_ACTIVE_TERRAIN_CHUNKS = 128

const VEC3_ONES = vec3.create(1, 1, 1)

const sHalfExtent = vec3.create()
const sWorldMin = vec3.create()
const sWorldMax = vec3.create()
const sMacroMin = vec3.create()
const sMacroMax = vec3.create()
const sChunkCenter = vec3.create()
const sChunkCoord = vec3.create()
const sVoxel = vec3.create()
const sParcelCopyOrigin = vec3.create()
const sCamChunk = vec3.create()
const sTerrainCenterChunk = vec3.create(Number.NaN, 0, Number.NaN)

export const chunkPosHalf = new Float32Array(MAX_ACTIVE_TERRAIN_CHUNKS * 4)
export const voxelWords = new Uint32Array(MAX_ACTIVE_TERRAIN_CHUNKS * VOXEL_WORDS_PER_CHUNK)
export const macroGridTerrain = new Uint32Array(MACRO_CELL_COUNT * MAX_CHUNKS_PER_MACRO)
export const macroCounts = new Uint8Array(MACRO_CELL_COUNT)

type TerrainChunkSlot = {
  cx: number
  cy: number
  cz: number
  slot: number
}

const GROUND_CLR = nearestPaletteIndexFromRgb(1, 1, 1)
const GRID_CLR = nearestPaletteIndexFromRgb(0.2, 0.2, 0.2)
/** grid line every 8m, and a world voxel is 10cm */
const GRID_SPACING = 80

let parcelMap: ParcelMap | null = null
const parcelFieldCache = new Map<number, VoxelData>()
const parcelLoadQueue = new Set<number>()
const propsDirtyListeners: Array<() => void> = []

export function onPropsDirty(fn: () => void) {
  propsDirtyListeners.push(fn)
}

function notifyPropsDirty() {
  for (const fn of propsDirtyListeners) fn()
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
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
  return nearestPaletteIndexFromRgb(hexToRgb(hex).r, hexToRgb(hex).g, hexToRgb(hex).b)
}

/** Upscale a retro 50cm field into a 10cm VoxelData (5x per axis). */
function upscaleField(field: { get: (x: number, y: number, z: number) => number; shape: number[] }, colors: string[]): VoxelData {
  const [fx, fy, fz] = field.shape
  const out = new VoxelData(vec3.fromValues(fx * FIELD_UPSCALE, fy * FIELD_UPSCALE, fz * FIELD_UPSCALE))
  out.clear()
  const p = vec3.create()
  for (let z = 0; z < fz; z++) {
    for (let y = 0; y < fy; y++) {
      for (let x = 0; x < fx; x++) {
        const v = field.get(x, y, z)
        if (!v) continue
        const clr = blockToPalette(v, colors)
        if (!clr) continue
        for (let dz = 0; dz < FIELD_UPSCALE; dz++) {
          for (let dy = 0; dy < FIELD_UPSCALE; dy++) {
            for (let dx = 0; dx < FIELD_UPSCALE; dx++) {
              vec3.set(x * FIELD_UPSCALE + dx, y * FIELD_UPSCALE + dy, z * FIELD_UPSCALE + dz, p)
              out.set(p, clr)
            }
          }
        }
      }
    }
  }
  return out
}

async function fetchParcelContent(id: number): Promise<ParcelContent | null> {
  try {
    const res = await fetch(api(`/grid/parcels/${id}`))
    if (!res.ok) return null
    const json = (await res.json()) as { success?: boolean; parcel?: any }
    if (!json?.parcel) return null
    const p = json.parcel
    return {
      voxels: p.voxels || '',
      palette: p.palette,
      features: p.features,
    }
  } catch {
    return null
  }
}

function buildField(parcel: Parcel, content: ParcelContent): VoxelData | null {
  if (!content.voxels) return null
  const [ox, oy, oz] = parcel.originM
  const mx = (parcel.bounds.max[0] - parcel.bounds.min[0]) / 10
  const my = (parcel.bounds.max[1] - parcel.bounds.min[1]) / 10
  const mz = (parcel.bounds.max[2] - parcel.bounds.min[2]) / 10
  const fieldShape = getFieldShape({ x1: ox, y1: oy, z1: oz, x2: ox + mx, y2: oy + my, z2: oz + mz })
  if (fieldShape[0] <= 0 || fieldShape[1] <= 0 || fieldShape[2] <= 0) return null
  const buf = getBufferFromVoxels({ fieldShape, voxels: content.voxels })
  if (!buf) return null
  const colors = (content.palette && content.palette.length ? content.palette : defaultColors).map((c, i) => c || defaultColors[i] || '#ffffff')
  return upscaleField(buf, colors)
}

async function ensureParcelLoaded(parcel: Parcel) {
  if (parcelFieldCache.has(parcel.id) || parcelLoadQueue.has(parcel.id)) return
  parcelLoadQueue.add(parcel.id)
  try {
    const content = await fetchParcelContent(parcel.id)
    if (!content) return
    parcel.content = content
    const field = buildField(parcel, content)
    if (field) parcelFieldCache.set(parcel.id, field)
    notifyPropsDirty()
    // force rebuild so newly loaded field lands in chunks
    sTerrainCenterChunk[0] = Number.NaN
    sTerrainCenterChunk[2] = Number.NaN
  } catch (e) {
    console.error(`raycast: parcel ${parcel.id} load failed`, e)
  } finally {
    parcelLoadQueue.delete(parcel.id)
  }
}

export async function loadTerrainParcels(): Promise<void> {
  const res = await fetch(api('/api/parcels/cached.json'))
  if (!res.ok) throw new Error(`parcels: ${res.status}`)
  const json = (await res.json()) as { parcels?: unknown[]; success?: boolean }
  const raw = Array.isArray(json) ? json : json.parcels
  if (!Array.isArray(raw)) throw new Error('parcels: bad payload')

  const list: ReturnType<typeof parseParcelRecord>[] = []
  const origins = new Map<number, [number, number, number]>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    if (typeof o.id !== 'number') continue
    if (typeof o.x1 === 'number' && typeof o.y1 === 'number' && typeof o.z1 === 'number') {
      origins.set(o.id, [o.x1, o.y1, o.z1])
    }
    const parsed = parseParcelRecord(row)
    if (parsed) list.push(parsed)
  }
  parcelMap = new ParcelMap(
    list.filter((p): p is NonNullable<typeof p> => p != null),
    origins,
  )
  parcelFieldCache.clear()
}

export const activeTerrain: TerrainChunkSlot[] = []

export function computeGridAnchor(cam: Vec3Arg): Vec3 {
  const half = Math.floor(MACRO_RES / 2)
  const out = vec3.create()
  vec3.scale(cam, MACRO_INV_CELL_WORLD, out)
  vec3.floor(out, out)
  out[0] -= half
  out[1] -= half
  out[2] -= half
  return out
}

function euclidMod(n: number, m: number): number {
  return utils.euclideanModulo(n, m)
}

function createTerrainChunk(chunkCoord: Vec3Arg): VoxelData {
  const chunk = new VoxelData(TERRAIN_CHUNK_SHAPE)
  chunk.words.fill(0xffff_ffff)
  const { words: w } = chunk
  const sx = TERRAIN_CHUNK_SHAPE[0]
  const sy = TERRAIN_CHUNK_SHAPE[1]
  const sz = TERRAIN_CHUNK_SHAPE[2]

  // one voxel thick white floor with dark grey grid lines, at world y 0
  if (chunkCoord[1] === 0) {
    for (sVoxel[2] = 0; sVoxel[2] < sz; sVoxel[2]++) {
      for (sVoxel[0] = 0; sVoxel[0] < sx; sVoxel[0]++) {
        const worldX = chunkCoord[0] * sx + sVoxel[0]
        const worldZ = chunkCoord[2] * sz + sVoxel[2]
        const line = euclidMod(worldX, GRID_SPACING) === 0 || euclidMod(worldZ, GRID_SPACING) === 0
        const voxelIndex = sVoxel[0] + sVoxel[2] * sx * sy
        const wordIndex = voxelIndex >>> 2
        const shift = (voxelIndex & 3) * 8
        const mask = 0xff << shift
        w[wordIndex] = (w[wordIndex] & ~mask) | ((line ? GRID_CLR : GROUND_CLR) << shift)
      }
    }
  }

  const chunkBounds = Bounds.create(chunkCoord[0] * sx, chunkCoord[1] * sy, chunkCoord[2] * sz, (chunkCoord[0] + 1) * sx, (chunkCoord[1] + 1) * sy, (chunkCoord[2] + 1) * sz)
  const parcelsHere = parcelMap?.search(chunkBounds) ?? []
  const chunkWorldMinX = chunkCoord[0] * sx
  const chunkWorldMinY = chunkCoord[1] * sy
  const chunkWorldMinZ = chunkCoord[2] * sz

  for (const parcel of parcelsHere) {
    void ensureParcelLoaded(parcel)
    const src = parcelFieldCache.get(parcel.id)
    if (!src) continue
    sParcelCopyOrigin[0] = parcel.bounds.min[0] - chunkWorldMinX
    sParcelCopyOrigin[1] = parcel.bounds.min[1] - chunkWorldMinY
    sParcelCopyOrigin[2] = parcel.bounds.min[2] - chunkWorldMinZ
    src.copy(sParcelCopyOrigin, chunk)
  }

  return chunk
}

function clearMacroGrid() {
  macroGridTerrain.fill(0xffff_ffff)
  macroCounts.fill(0)
}

function insertChunkToMacroGrid(anchor: Vec3Arg, chunkCenter: Vec3Arg, chunkSlot: number) {
  const halfScalar = VOX_RES * VOXEL_WORLD_SCALE * 0.5
  vec3.set(halfScalar, halfScalar, halfScalar, sHalfExtent)
  vec3.subtract(chunkCenter, sHalfExtent, sWorldMin)
  vec3.add(chunkCenter, sHalfExtent, sWorldMax)

  vec3.scale(sWorldMin, MACRO_INV_CELL_WORLD, sMacroMin)
  vec3.floor(sMacroMin, sMacroMin)
  vec3.scale(sWorldMax, MACRO_INV_CELL_WORLD, sMacroMax)
  vec3.ceil(sMacroMax, sMacroMax)
  vec3.sub(sMacroMax, VEC3_ONES, sMacroMax)

  for (let wz = sMacroMin[2]; wz <= sMacroMax[2]; wz++) {
    for (let wy = sMacroMin[1]; wy <= sMacroMax[1]; wy++) {
      for (let wx = sMacroMin[0]; wx <= sMacroMax[0]; wx++) {
        const bx = euclidMod(wx - anchor[0], MACRO_RES)
        const by = euclidMod(wy - anchor[1], MACRO_RES)
        const bz = euclidMod(wz - anchor[2], MACRO_RES)
        const cell = bx + by * MACRO_RES + bz * MACRO_RES * MACRO_RES
        if (macroCounts[cell] >= MAX_CHUNKS_PER_MACRO) continue
        macroGridTerrain[cell * MAX_CHUNKS_PER_MACRO + macroCounts[cell]] = chunkSlot
        macroCounts[cell]++
      }
    }
  }
}

export function updateTerrainStreaming(cameraPos: Vec3Arg, anchor: Vec3Arg): boolean {
  vec3.set(Math.floor(cameraPos[0] / TERRAIN_CHUNK_WORLD), Math.floor(cameraPos[1] / TERRAIN_CHUNK_WORLD), Math.floor(cameraPos[2] / TERRAIN_CHUNK_WORLD), sCamChunk)

  if (
    Number.isFinite(sTerrainCenterChunk[0]) &&
    Number.isFinite(sTerrainCenterChunk[2]) &&
    Math.abs(sCamChunk[0] - sTerrainCenterChunk[0]) < TERRAIN_STREAM_THRESHOLD_CHUNKS &&
    Math.abs(sCamChunk[2] - sTerrainCenterChunk[2]) < TERRAIN_STREAM_THRESHOLD_CHUNKS
  ) {
    return false
  }

  vec3.copy(sCamChunk, sTerrainCenterChunk)

  activeTerrain.length = 0
  clearMacroGrid()
  voxelWords.fill(0xffff_ffff)

  // todo: streaming rebuilds all chunks sync and hitchs
  const candidates: Array<{ cx: number; cy: number; cz: number; dist2: number }> = []
  for (let dy = 0; dy < TERRAIN_Y_LAYERS; dy++) {
    for (let dz = -TERRAIN_RADIUS_CHUNKS; dz <= TERRAIN_RADIUS_CHUNKS; dz++) {
      for (let dx = -TERRAIN_RADIUS_CHUNKS; dx <= TERRAIN_RADIUS_CHUNKS; dx++) {
        candidates.push({
          cx: sCamChunk[0] + dx,
          cy: dy,
          cz: sCamChunk[2] + dz,
          dist2: dx * dx + dz * dz + dy * dy * 0.25,
        })
      }
    }
  }
  candidates.sort((a, b) => a.dist2 - b.dist2)

  const halfWorldExtent = VOX_RES * VOXEL_WORLD_SCALE * 0.5
  let nextSlot = 0
  for (let i = 0; i < candidates.length && nextSlot < MAX_ACTIVE_TERRAIN_CHUNKS; i++) {
    const c = candidates[i]
    vec3.set(c.cx, c.cy, c.cz, sChunkCoord)
    const chunk = createTerrainChunk(sChunkCoord)
    const slot = nextSlot++
    voxelWords.set(chunk.words, slot * VOXEL_WORDS_PER_CHUNK)

    // world meters = voxelIndex * 0.1 on all axes (chunk center at half-extent)
    vec3.set((c.cx + 0.5) * TERRAIN_CHUNK_WORLD, (c.cy + 0.5) * TERRAIN_CHUNK_WORLD, (c.cz + 0.5) * TERRAIN_CHUNK_WORLD, sChunkCenter)

    const b = slot * 4
    chunkPosHalf[b + 0] = sChunkCenter[0]
    chunkPosHalf[b + 1] = sChunkCenter[1]
    chunkPosHalf[b + 2] = sChunkCenter[2]
    chunkPosHalf[b + 3] = halfWorldExtent

    activeTerrain.push({ cx: c.cx, cy: c.cy, cz: c.cz, slot })
    insertChunkToMacroGrid(anchor, sChunkCenter, slot)
  }

  return true
}

export function forceTerrainRebuild(cameraPos: Vec3Arg, anchor: Vec3Arg): boolean {
  sTerrainCenterChunk[0] = Number.NaN
  sTerrainCenterChunk[2] = Number.NaN
  return updateTerrainStreaming(cameraPos, anchor)
}

export function getParcelMap(): ParcelMap | null {
  return parcelMap
}

export function nearbyParcelsWithContent(cam: Vec3Arg, radiusM = 48): Parcel[] {
  if (!parcelMap) return []
  const r = radiusM / VOXEL_WORLD_SCALE
  const cx = cam[0] / VOXEL_WORLD_SCALE
  const cy = cam[1] / VOXEL_WORLD_SCALE
  const cz = cam[2] / VOXEL_WORLD_SCALE
  const q = Bounds.create(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r)
  return parcelMap.search(q).filter((p) => p.content?.features)
}
