import { vec3, utils, type Vec3, type Vec3Arg } from 'wgpu-matrix'
import { BrickPool, DIR_LEN, DIR_WORDS_PER_CHUNK, LOD_CHUNK_WORLD, LOD_COUNT, LOD_Y_LAYERS, MAX_CHUNKS, parseMeke } from './bricks'

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
const MAX_CHUNKS_PER_MACRO = 32
const MACRO_INV_CELL_WORLD = 1 / MACRO_CELL_WORLD

const LOD_COL_LO = -2
const LOD_COL_HI = 2
/** keep chunks this many columns beyond the desired window before freeing */
const EVICT_MARGIN = 2

const INFLIGHT_MAX = 8

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

/** baked chunk keys from index.json; keys not in here are air */
let baked: Set<string> | null = null

function chunkKey(lod: number, cx: number, cy: number, cz: number) {
  return `${lod}:${cx}:${cy}:${cz}`
}

function parseKey(key: string): { lod: number; cx: number; cy: number; cz: number } {
  const [lod, cx, cy, cz] = key.split(':').map(Number)
  return { lod, cx, cy, cz }
}

export async function loadTerrainIndex(): Promise<number> {
  try {
    const res = await fetch(api('/poneke/index.json'))
    if (!res.ok) throw new Error(`${res.status}`)
    const json = (await res.json()) as { chunks?: string[] }
    baked = new Set(json.chunks || [])
  } catch (e) {
    console.error('raycast: chunk index failed (run npm run bake:poneke), sky only', e)
    baked = new Set()
  }
  return baked.size
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
      for (let dz = LOD_COL_LO; dz <= LOD_COL_HI; dz++) {
        for (let dx = LOD_COL_LO; dx <= LOD_COL_HI; dx++) {
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

let macroOverflow = 0

function clearMacroGrid() {
  macroGridTerrain.fill(0xffff_ffff)
  macroCounts.fill(0)
  macroOverflow = 0
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
        if (macroCounts[cell] >= MAX_CHUNKS_PER_MACRO) {
          macroOverflow++
          continue
        }
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

async function loadOne(key: string): Promise<boolean> {
  const { lod, cx, cy, cz } = parseKey(key)
  const res = await fetch(api(`/poneke/${lod}/${cx}_${cy}_${cz}.meke`))
  if (!res.ok) return false
  const local = parseMeke(new Uint8Array(await res.arrayBuffer()))
  if (!local) return false
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

    // hysteresis: undesired chunks linger EVICT_MARGIN columns so replacements
    // can stream in first. coarse chunks under the finer ring go immediately
    // (they'd occlude the fine voxels).
    for (const [key, slot] of [...slotByKey]) {
      if (lastDesired.has(key)) continue
      const { lod, cx, cz } = parseKey(key)
      const world = LOD_CHUNK_WORLD[lod]
      const dx = cx - Math.floor(cameraPos[0] / world)
      const dz = cz - Math.floor(cameraPos[2] / world)
      const inHole = lod > 0 && dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0
      const far = LOD_COL_HI + EVICT_MARGIN
      if (inHole || Math.abs(dx) > far || Math.abs(dz) > far) freeSlot(slot)
    }

    for (const key of lastDesired) {
      if (!baked?.has(key)) continue
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
    void loadOne(key)
      .catch((e) => console.error('raycast: chunk load failed', key, e))
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

export function poolStats() {
  return {
    ...pool.stats(),
    slots: slotByKey.size,
    macroOverflow,
  }
}

/** directory view for a slot — used by click-delete */
export function slotDirectory(slot: number): Uint32Array {
  return directories.subarray(slot * DIR_WORDS_PER_CHUNK, (slot + 1) * DIR_WORDS_PER_CHUNK)
}
