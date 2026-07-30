import { vec3, utils, type Vec3, type Vec3Arg } from 'wgpu-matrix'
import { createComlinkWorker } from '../../common/helpers/comlink-worker'
import { BrickPool, DIR_LEN, DIR_WORDS_PER_CHUNK, MAX_CHUNKS, type Brickified } from './bricks'
import { LOD_CHUNK_WORLD, LOD_COUNT, LOD_VOXEL_SCALE, LOD_Y_LAYERS } from './gen'
import { Bounds } from './math/bounds'
import { ParcelMap, parseParcelRecord, type Parcel, type ParcelContent } from './parcel'
import type { RaycastWorkerApi } from './worker'
import workerFallback from './worker'

const MAT4_F32_SIZE = 16 * Float32Array.BYTES_PER_ELEMENT
const VEC4_U32_SIZE = 4 * Uint32Array.BYTES_PER_ELEMENT
const alignTo = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment

export const UNIFORM_GRID_ANCHOR_OFFSET = alignTo(MAT4_F32_SIZE + VEC4_U32_SIZE, 16)
export const UNIFORM_TERRAIN_PARAMS_OFFSET = UNIFORM_GRID_ANCHOR_OFFSET + VEC4_U32_SIZE
export const UNIFORM_BUFFER_SIZE = alignTo(UNIFORM_TERRAIN_PARAMS_OFFSET + VEC4_U32_SIZE, 16)

export { VOX_RES } from './bricks'
export const MAX_ACTIVE_TERRAIN_CHUNKS = MAX_CHUNKS
export { DIR_WORDS_PER_CHUNK }

export const api = (path: string) => (process.env.NODE_ENV !== 'production' ? (process.env.ASSET_PATH || '') + path : path)

const MACRO_RES = 32
const MACRO_CELL_WORLD = 8
const MACRO_CELL_COUNT = MACRO_RES ** 3
const MAX_CHUNKS_PER_MACRO = 16
const MACRO_INV_CELL_WORLD = 1 / MACRO_CELL_WORLD

const LOD_COL_LO = -2
const LOD_COL_HI = 2

const LRU_MAX_BYTES = 256 * 1024 * 1024
const INFLIGHT_MAX = 4

const VEC3_ONES = vec3.create(1, 1, 1)
const sHalfExtent = vec3.create()
const sWorldMin = vec3.create()
const sWorldMax = vec3.create()
const sMacroMin = vec3.create()
const sMacroMax = vec3.create()
const sChunkCenter = vec3.create()
const sMacroAnchor = vec3.create(Number.NaN, Number.NaN, Number.NaN)
const sCamLod0 = vec3.create(Number.NaN, 0, Number.NaN)

export const chunkPosHalf = new Float32Array(MAX_ACTIVE_TERRAIN_CHUNKS * 4)
export const directories = new Uint32Array(MAX_ACTIVE_TERRAIN_CHUNKS * DIR_WORDS_PER_CHUNK)
export const macroGridTerrain = new Uint32Array(MACRO_CELL_COUNT * MAX_CHUNKS_PER_MACRO)
export const macroCounts = new Uint8Array(MACRO_CELL_COUNT)
export const pool = new BrickPool()

export const dirtySlots: number[] = []
const pendingDirtySlots: number[] = []
let pendingMacroDirty = false

export type TerrainChunkSlot = {
  lod: number
  cx: number
  cy: number
  cz: number
  slot: number
}

export const activeTerrain: TerrainChunkSlot[] = []

const slotByKey = new Map<string, number>()
const keyBySlot: Array<string | null> = new Array(MAX_ACTIVE_TERRAIN_CHUNKS).fill(null)
const freeSlots: number[] = []
for (let i = MAX_ACTIVE_TERRAIN_CHUNKS - 1; i >= 0; i--) freeSlots.push(i)

const regenQueue: string[] = []
const regenSet = new Set<string>()
const inflight = new Set<string>()
let lastDesired = new Set<string>()

// CPU LRU of brickified outputs
const lru = new Map<string, Brickified>()
let lruBytes = 0

function lruTouch(key: string, data: Brickified) {
  if (lru.has(key)) {
    lru.delete(key)
  } else {
    lruBytes += data.brickBytes.byteLength + data.directory.byteLength
  }
  lru.set(key, data)
  while (lruBytes > LRU_MAX_BYTES && lru.size > 0) {
    const oldest = lru.keys().next().value as string
    const v = lru.get(oldest)!
    lru.delete(oldest)
    lruBytes -= v.brickBytes.byteLength + v.directory.byteLength
  }
}

function lruGet(key: string): Brickified | null {
  const v = lru.get(key)
  if (!v) return null
  lru.delete(key)
  lru.set(key, v)
  return v
}

type CachedMeta = {
  originM: [number, number, number]
  boundsMin: [number, number, number]
  boundsMax: [number, number, number]
  loaded: boolean
}

let parcelMap: ParcelMap | null = null
const parcelMeta = new Map<number, CachedMeta>()
const parcelLoadQueue = new Set<number>()
let workerApi: RaycastWorkerApi | null = null
let workerReady: Promise<void> | null = null

function chunkKey(lod: number, cx: number, cy: number, cz: number) {
  return `${lod}:${cx}:${cy}:${cz}`
}

function parseKey(key: string): { lod: number; cx: number; cy: number; cz: number } {
  const [lod, cx, cy, cz] = key.split(':').map(Number)
  return { lod, cx, cy, cz }
}

export async function initTerrainWorker() {
  if (workerReady) return workerReady
  workerReady = (async () => {
    const { worker } = await createComlinkWorker<RaycastWorkerApi>(
      () => new Worker(new URL('./worker.ts', import.meta.url)),
      () => workerFallback,
      { workerName: 'raycast-terrain' },
    )
    workerApi = worker
  })()
  return workerReady
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

function dirtyChunksForParcel(parcel: Parcel) {
  const b = parcel.bounds
  for (const [key] of slotByKey) {
    const { lod, cx, cy, cz } = parseKey(key)
    const world = LOD_CHUNK_WORLD[lod]
    const scale = LOD_VOXEL_SCALE[lod]
    const minX = (cx * world) / 0.1
    const minY = (cy * world) / 0.1
    const minZ = (cz * world) / 0.1
    const maxX = minX + 64 * (scale / 0.1)
    const maxY = minY + 64 * (scale / 0.1)
    const maxZ = minZ + 64 * (scale / 0.1)
    if (maxX <= b.min[0] || minX >= b.max[0]) continue
    if (maxY <= b.min[1] || minY >= b.max[1]) continue
    if (maxZ <= b.min[2] || minZ >= b.max[2]) continue
    lru.delete(key)
    if (!regenSet.has(key)) {
      regenSet.add(key)
      regenQueue.push(key)
    }
  }
}

async function ensureParcelLoaded(parcel: Parcel) {
  const meta = parcelMeta.get(parcel.id)
  if (meta?.loaded || parcelLoadQueue.has(parcel.id)) return
  parcelLoadQueue.add(parcel.id)
  try {
    await initTerrainWorker()
    const content = await fetchParcelContent(parcel.id)
    if (!content?.voxels || !workerApi) return
    parcel.content = content
    const ok = await workerApi.loadParcel({
      id: parcel.id,
      originM: parcel.originM,
      boundsMin: [parcel.bounds.min[0], parcel.bounds.min[1], parcel.bounds.min[2]],
      boundsMax: [parcel.bounds.max[0], parcel.bounds.max[1], parcel.bounds.max[2]],
      voxels: content.voxels,
      palette: content.palette ?? undefined,
      features: content.features ?? null,
    })
    if (!ok) return
    parcelMeta.set(parcel.id, {
      originM: parcel.originM,
      boundsMin: [parcel.bounds.min[0], parcel.bounds.min[1], parcel.bounds.min[2]],
      boundsMax: [parcel.bounds.max[0], parcel.bounds.max[1], parcel.bounds.max[2]],
      loaded: true,
    })
    dirtyChunksForParcel(parcel)
  } catch (e) {
    console.error(`raycast: parcel ${parcel.id} load failed`, e)
  } finally {
    parcelLoadQueue.delete(parcel.id)
  }
}

export async function loadTerrainParcels(): Promise<void> {
  await initTerrainWorker()
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
  parcelMeta.clear()
}

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

function desiredKeys(cam: Vec3Arg): string[] {
  const out: string[] = []
  for (let lod = 0; lod < LOD_COUNT; lod++) {
    const world = LOD_CHUNK_WORLD[lod]
    const camX = Math.floor(cam[0] / world)
    const camZ = Math.floor(cam[2] / world)
    const yLayers = LOD_Y_LAYERS[lod]
    for (let dy = 0; dy < yLayers; dy++) {
      for (let dz = LOD_COL_LO; dz < LOD_COL_HI; dz++) {
        for (let dx = LOD_COL_LO; dx < LOD_COL_HI; dx++) {
          if (lod > 0 && dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0) continue
          out.push(chunkKey(lod, camX + dx, dy, camZ + dz))
        }
      }
    }
  }
  return out
}

function freeSlot(slot: number) {
  const key = keyBySlot[slot]
  if (key) slotByKey.delete(key)
  keyBySlot[slot] = null
  freeSlots.push(slot)
  const dir = directories.subarray(slot * DIR_WORDS_PER_CHUNK, (slot + 1) * DIR_WORDS_PER_CHUNK)
  pool.releaseDirectory(dir)
  dir.fill(0)
  const b = slot * 4
  chunkPosHalf[b] = 0
  chunkPosHalf[b + 1] = 0
  chunkPosHalf[b + 2] = 0
  chunkPosHalf[b + 3] = 0
}

function allocSlot(key: string): number | null {
  const slot = freeSlots.pop()
  if (slot === undefined) return null
  slotByKey.set(key, slot)
  keyBySlot[slot] = key
  return slot
}

function rebuildActiveList() {
  activeTerrain.length = 0
  for (const [key, slot] of slotByKey) {
    const { lod, cx, cy, cz } = parseKey(key)
    activeTerrain.push({ lod, cx, cy, cz, slot })
  }
}

function clearMacroGrid() {
  macroGridTerrain.fill(0xffff_ffff)
  macroCounts.fill(0)
}

function insertChunkToMacroGrid(anchor: Vec3Arg, chunkCenter: Vec3Arg, halfExtent: number, chunkSlot: number) {
  vec3.set(halfExtent, halfExtent, halfExtent, sHalfExtent)
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

function rebuildMacroGrid(anchor: Vec3Arg) {
  clearMacroGrid()
  for (const [key, slot] of slotByKey) {
    const { lod, cx, cy, cz } = parseKey(key)
    const world = LOD_CHUNK_WORLD[lod]
    const half = world * 0.5
    vec3.set((cx + 0.5) * world, (cy + 0.5) * world, (cz + 0.5) * world, sChunkCenter)
    insertChunkToMacroGrid(anchor, sChunkCenter, half, slot)
  }
}

function writeChunkSlot(slot: number, lod: number, cx: number, cy: number, cz: number, globalDir: Uint32Array) {
  // release previous bricks if re-writing
  const prev = directories.subarray(slot * DIR_WORDS_PER_CHUNK, (slot + 1) * DIR_WORDS_PER_CHUNK)
  let any = false
  for (let i = 0; i < DIR_LEN; i++) {
    if (prev[i]) {
      any = true
      break
    }
  }
  if (any) pool.releaseDirectory(prev)

  directories.set(globalDir, slot * DIR_WORDS_PER_CHUNK)
  const world = LOD_CHUNK_WORLD[lod]
  const half = world * 0.5
  const b = slot * 4
  chunkPosHalf[b + 0] = (cx + 0.5) * world
  chunkPosHalf[b + 1] = (cy + 0.5) * world
  chunkPosHalf[b + 2] = (cz + 0.5) * world
  chunkPosHalf[b + 3] = half
  pendingDirtySlots.push(slot)
  pendingMacroDirty = true
}

function kickParcelLoads(cam: Vec3Arg) {
  if (!parcelMap) return
  // load parcels out to fog distance so coarse LODs have content
  const r = 120 / 0.1
  const cx = cam[0] / 0.1
  const cy = cam[1] / 0.1
  const cz = cam[2] / 0.1
  const q = Bounds.create(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r)
  for (const p of parcelMap.search(q)) void ensureParcelLoaded(p)
}

async function generateOne(key: string): Promise<boolean> {
  const cached = lruGet(key)
  const { lod, cx, cy, cz } = parseKey(key)
  let local = cached
  if (!local) {
    if (!workerApi) await initTerrainWorker()
    if (!workerApi) return false
    local = await workerApi.genChunk(lod, cx, cy, cz)
    lruTouch(key, local)
  }
  if (!lastDesired.has(key) && !slotByKey.has(key)) return false
  let slot = slotByKey.get(key)
  if (slot == null) {
    if (!lastDesired.has(key)) return false
    const next = allocSlot(key)
    if (next == null) return false
    slot = next
  }
  const global = pool.install(local)
  if (!global) {
    // pool full — requeue
    if (!regenSet.has(key)) {
      regenSet.add(key)
      regenQueue.push(key)
    }
    return false
  }
  writeChunkSlot(slot, lod, cx, cy, cz, global)
  return true
}

export type TerrainFrame = {
  dirtySlots: number[]
  dirtyBricks: number[]
  macroDirty: boolean
}

export function updateTerrainStreaming(cameraPos: Vec3Arg, anchor: Vec3Arg): TerrainFrame {
  dirtySlots.length = 0
  dirtySlots.push(...pendingDirtySlots)
  pendingDirtySlots.length = 0
  let macroDirty = pendingMacroDirty
  pendingMacroDirty = false

  const cam0x = Math.floor(cameraPos[0] / LOD_CHUNK_WORLD[0])
  const cam0z = Math.floor(cameraPos[2] / LOD_CHUNK_WORLD[0])
  const camMoved = !Number.isFinite(sCamLod0[0]) || Math.abs(cam0x - sCamLod0[0]) >= 1 || Math.abs(cam0z - sCamLod0[2]) >= 1
  const anchorMoved = anchor[0] !== sMacroAnchor[0] || anchor[1] !== sMacroAnchor[1] || anchor[2] !== sMacroAnchor[2]

  if (camMoved) {
    vec3.set(cam0x, 0, cam0z, sCamLod0)
    lastDesired = new Set(desiredKeys(cameraPos))
    kickParcelLoads(cameraPos)

    for (const [key, slot] of [...slotByKey]) {
      if (!lastDesired.has(key)) freeSlot(slot)
    }

    for (const key of lastDesired) {
      if (slotByKey.has(key)) continue
      if (regenSet.has(key) || inflight.has(key)) continue
      regenSet.add(key)
      regenQueue.push(key)
    }

    if (regenQueue.length) {
      const next: string[] = []
      for (const key of regenQueue) {
        if (lastDesired.has(key) || slotByKey.has(key)) next.push(key)
        else regenSet.delete(key)
      }
      regenQueue.length = 0
      regenQueue.push(...next)
    }

    rebuildActiveList()
  }

  while (regenQueue.length && inflight.size < INFLIGHT_MAX) {
    const key = regenQueue.shift()!
    regenSet.delete(key)
    if (!lastDesired.has(key) && !slotByKey.has(key)) continue
    if (inflight.has(key)) continue
    inflight.add(key)
    void generateOne(key)
      .catch((e) => console.error('raycast: chunk gen failed', key, e))
      .finally(() => inflight.delete(key))
  }

  if (dirtySlots.length) rebuildActiveList()

  if (anchorMoved || dirtySlots.length || camMoved || macroDirty) {
    vec3.copy(anchor, sMacroAnchor)
    rebuildMacroGrid(anchor)
    macroDirty = true
  }

  const dirtyBricks = pool.dirty.splice(0)
  return { dirtySlots, dirtyBricks, macroDirty }
}

export function getParcelMap(): ParcelMap | null {
  return parcelMap
}

export function poolStats() {
  return {
    ...pool.stats(),
    lruChunks: lru.size,
    lruMb: lruBytes / (1024 * 1024),
    slots: slotByKey.size,
  }
}

/** directory view for a slot — used by click-delete */
export function slotDirectory(slot: number): Uint32Array {
  return directories.subarray(slot * DIR_WORDS_PER_CHUNK, (slot + 1) * DIR_WORDS_PER_CHUNK)
}
