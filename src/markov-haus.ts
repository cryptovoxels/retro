import ndarray from 'ndarray'
import { getBlockId } from '../common/content/blocks'
import { getVoxelsFromBuffer } from '../common/voxels/helpers'
import type Parcel from './parcel'

// uint8 field: 0 empty, 1..16 block ids. legacy uint16 only at formatParcel.
export const BLOCK = {
  empty: 0,
  wall: 3, // white
  floor: 5, // bricks
  glass: 2, // window tex (no solid bit via getBlockId)
  accent: 12, // weeblob vibes
  partition: 10, // subgrid
  rail: 8, // line - deck rails
} as const

const FLOOR_H = 6
const MAX_MARGIN = 4
const MIN_SPAN = 4
const WINDOW_BAND = 2 // wall rows above floor that can take glass
const RAIL_H = 2

type Footprint = { x0: number; x1: number; z0: number; z1: number }
type Story = { y0: number; y1: number; foot: Footprint }

type Mode = 'one' | 'all'

type Rule = {
  mode: Mode
  from: number[][][]
  to: number[][][]
  steps?: number
}

function rnd(n: number) {
  return (Math.random() * n) | 0
}

function clampMargin(m: number, size: number) {
  const max = Math.max(0, Math.min(MAX_MARGIN, ((size - MIN_SPAN) / 2) | 0))
  return Math.min(m, max)
}

function rollFootprint(sx: number, sz: number): Footprint {
  let x0 = clampMargin(rnd(MAX_MARGIN + 1), sx)
  let x1 = sx - 1 - clampMargin(rnd(MAX_MARGIN + 1), sx)
  let z0 = clampMargin(rnd(MAX_MARGIN + 1), sz)
  let z1 = sz - 1 - clampMargin(rnd(MAX_MARGIN + 1), sz)
  if (x1 - x0 + 1 < MIN_SPAN) {
    x0 = 0
    x1 = sx - 1
  }
  if (z1 - z0 + 1 < MIN_SPAN) {
    z0 = 0
    z1 = sz - 1
  }
  return { x0, x1, z0, z1 }
}

function idx(x: number, y: number, z: number, sx: number, sy: number) {
  return x + y * sx + z * sx * sy
}

function inFoot(f: Footprint, x: number, z: number) {
  return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1
}

function onEdge(f: Footprint, x: number, z: number) {
  return inFoot(f, x, z) && (x === f.x0 || x === f.x1 || z === f.z0 || z === f.z1)
}

// --- tiny rewrite engine (one/all, yaw only) ---

const CHAR_ID: Record<string, number> = {
  B: BLOCK.empty,
  W: BLOCK.wall,
  F: BLOCK.floor,
  G: BLOCK.glass,
  A: BLOCK.accent,
  P: BLOCK.partition,
  R: BLOCK.rail,
}

function parsePattern(pat: string): number[][][] {
  // "aaa/bbb ccc/ddd" → z slices of y rows of x cells. * = 255 wildcard
  const slices = pat.trim().split(/\s+/)
  return slices.map((slice) =>
    slice.split('/').map((row) =>
      [...row].map((c) => {
        if (c === '*') return 255
        return CHAR_ID[c] ?? 0
      }),
    ),
  )
}

export function parseRule(mode: Mode, text: string, steps?: number): Rule {
  const [a, b] = text.split('=')
  return { mode, from: parsePattern(a!), to: parsePattern(b!), steps }
}

function yaw90(p: number[][][]): number[][][] {
  // [z][y][x] rotate 90 CW around Y
  const pz = p.length
  const py = p[0]!.length
  const px = p[0]![0]!.length
  const out: number[][][] = []
  for (let z = 0; z < px; z++) {
    const slice: number[][] = []
    for (let y = 0; y < py; y++) {
      const row: number[] = []
      for (let x = 0; x < pz; x++) {
        row.push(p[x]![y]![px - 1 - z]!)
      }
      slice.push(row)
    }
    out.push(slice)
  }
  return out
}

function yaw(p: number[][][], k: number): number[][][] {
  let cur = p
  for (let n = 0; n < k; n++) cur = yaw90(cur)
  return cur
}

function matchAt(grid: Uint8Array, sx: number, sy: number, sz: number, x: number, y: number, z: number, pat: number[][][]): boolean {
  const pz = pat.length
  const py = pat[0]!.length
  const px = pat[0]![0]!.length
  if (x + px > sx || y + py > sy || z + pz > sz) return false
  for (let dz = 0; dz < pz; dz++) {
    for (let dy = 0; dy < py; dy++) {
      for (let dx = 0; dx < px; dx++) {
        const want = pat[dz]![dy]![dx]!
        if (want === 255) continue
        if (grid[idx(x + dx, y + dy, z + dz, sx, sy)] !== want) return false
      }
    }
  }
  return true
}

function writeAt(grid: Uint8Array, sx: number, sy: number, x: number, y: number, z: number, pat: number[][][]) {
  const pz = pat.length
  const py = pat[0]!.length
  const px = pat[0]![0]!.length
  for (let dz = 0; dz < pz; dz++) {
    for (let dy = 0; dy < py; dy++) {
      for (let dx = 0; dx < px; dx++) {
        const v = pat[dz]![dy]![dx]!
        if (v === 255) continue
        grid[idx(x + dx, y + dy, z + dz, sx, sy)] = v
      }
    }
  }
}

function applyRule(grid: Uint8Array, shape: [number, number, number], rule: Rule): boolean {
  const [sx, sy, sz] = shape
  type Hit = { x: number; y: number; z: number; r: number; from: number[][][]; to: number[][][] }
  const hits: Hit[] = []

  for (let r = 0; r < 4; r++) {
    const from = yaw(rule.from, r)
    const to = yaw(rule.to, r)
    const pz = from.length
    const py = from[0]!.length
    const px = from[0]![0]!.length
    for (let z = 0; z <= sz - pz; z++) {
      for (let y = 0; y <= sy - py; y++) {
        for (let x = 0; x <= sx - px; x++) {
          if (matchAt(grid, sx, sy, sz, x, y, z, from)) hits.push({ x, y, z, r, from, to })
        }
      }
    }
  }

  if (!hits.length) return false

  if (rule.mode === 'one') {
    const h = hits[rnd(hits.length)]!
    writeAt(grid, sx, sy, h.x, h.y, h.z, h.to)
    return true
  }

  // all: non-overlapping in scan order, shuffle first for vibes
  for (let i = hits.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    const t = hits[i]!
    hits[i] = hits[j]!
    hits[j] = t
  }
  const used = new Uint8Array(sx * sy * sz)
  let any = false
  for (const h of hits) {
    const pz = h.to.length
    const py = h.to[0]!.length
    const px = h.to[0]![0]!.length
    let ok = true
    for (let dz = 0; dz < pz && ok; dz++) {
      for (let dy = 0; dy < py && ok; dy++) {
        for (let dx = 0; dx < px; dx++) {
          if (h.to[dz]![dy]![dx] === 255) continue
          if (used[idx(h.x + dx, h.y + dy, h.z + dz, sx, sy)]) {
            ok = false
            break
          }
        }
      }
    }
    if (!ok) continue
    writeAt(grid, sx, sy, h.x, h.y, h.z, h.to)
    for (let dz = 0; dz < pz; dz++) {
      for (let dy = 0; dy < py; dy++) {
        for (let dx = 0; dx < px; dx++) {
          if (h.to[dz]![dy]![dx] === 255) continue
          used[idx(h.x + dx, h.y + dy, h.z + dz, sx, sy)] = 1
        }
      }
    }
    any = true
  }
  return any
}

export function runStages(grid: Uint8Array, shape: [number, number, number], stages: Rule[][]) {
  const budget = shape[0] * shape[1] * shape[2] * 2
  for (const stage of stages) {
    let left = budget
    while (left-- > 0) {
      let hit = false
      for (const rule of stage) {
        const steps = rule.steps ?? 1 << 20
        let n = 0
        while (n < steps && applyRule(grid, shape, rule)) {
          n++
          hit = true
          if (rule.mode === 'all') break
        }
        if (hit && rule.mode === 'one') break
      }
      if (!hit) break
    }
  }
}

// --- haus pipeline: massing → structure → openings → dress ---

function rollStories(sx: number, sy: number, sz: number): Story[] {
  const stories: Story[] = []
  for (let y0 = 0; y0 < sy; y0 += FLOOR_H) {
    const y1 = Math.min(sy - 1, y0 + FLOOR_H - 1)
    if (y1 - y0 < 2) break // need floor + wall + ceiling
    stories.push({ y0, y1, foot: rollFootprint(sx, sz) })
  }
  return stories
}

function fillSlab(grid: Uint8Array, sx: number, sy: number, foot: Footprint, y: number, id: number) {
  for (let z = foot.z0; z <= foot.z1; z++) {
    for (let x = foot.x0; x <= foot.x1; x++) {
      grid[idx(x, y, z, sx, sy)] = id
    }
  }
}

function buildStructure(grid: Uint8Array, sx: number, sy: number, stories: Story[]) {
  for (const { y0, y1, foot } of stories) {
    // sealed box: floor + ceiling + perimeter walls (cantilevers vs neighbors are fine)
    fillSlab(grid, sx, sy, foot, y0, BLOCK.floor)
    fillSlab(grid, sx, sy, foot, y1, BLOCK.floor)

    for (let y = y0 + 1; y < y1; y++) {
      for (let z = foot.z0; z <= foot.z1; z++) {
        for (let x = foot.x0; x <= foot.x1; x++) {
          if (!onEdge(foot, x, z)) continue
          grid[idx(x, y, z, sx, sy)] = BLOCK.wall
        }
      }
    }
  }
}

function isCorner(f: Footprint, x: number, z: number) {
  return (x === f.x0 || x === f.x1) && (z === f.z0 || z === f.z1)
}

/** Fenestration mask: 1 = may become glass. Never written onto structure until applyOpenings. */
function buildFenestration(sx: number, sy: number, sz: number, stories: Story[]): Uint8Array {
  const mask = new Uint8Array(sx * sy * sz)
  for (const { y0, y1, foot } of stories) {
    const yLo = y0 + 1
    const yHi = Math.min(y0 + WINDOW_BAND, y1 - 1)
    if (yHi < yLo) continue

    // budget ~1/4 of non-corner perimeter cells per wall row
    for (let y = yLo; y <= yHi; y++) {
      for (let z = foot.z0; z <= foot.z1; z++) {
        for (let x = foot.x0; x <= foot.x1; x++) {
          if (!onEdge(foot, x, z) || isCorner(foot, x, z)) continue
          // stride pattern — solid-heavy, some windows
          if ((x * 3 + z * 5 + y) % 5 !== 0) continue
          mask[idx(x, y, z, sx, sy)] = 1
        }
      }
    }
  }
  return mask
}

function applyOpenings(grid: Uint8Array, mask: Uint8Array, sx: number, sy: number, sz: number, stories: Story[]) {
  // glass only where structure is wall AND mask says so
  for (let i = 0; i < grid.length; i++) {
    if (mask[i] && grid[i] === BLOCK.wall) grid[i] = BLOCK.glass
  }

  // ground door punch (structure opening, not fenestration)
  const ground = stories[0]
  if (!ground) return
  const { y0, y1, foot } = ground
  const mx = ((foot.x0 + foot.x1) / 2) | 0
  const yDoorTop = Math.min(y0 + 3, y1 - 1)
  for (let y = y0 + 1; y <= yDoorTop; y++) {
    for (const x of [mx, mx + 1]) {
      if (x > foot.x1) continue
      grid[idx(x, y, foot.z1, sx, sy)] = BLOCK.empty
      // door clears fenestration too
      mask[idx(x, y, foot.z1, sx, sy)] = 0
    }
  }
}

function buildPartitions(grid: Uint8Array, sx: number, sy: number, stories: Story[]) {
  for (const { y0, y1, foot } of stories) {
    const spanX = foot.x1 - foot.x0
    const spanZ = foot.z1 - foot.z0
    if (spanX < 6 || spanZ < 6) continue

    if (rnd(2) === 0) {
      const px = foot.x0 + 2 + rnd(Math.max(1, spanX - 3))
      const zA = foot.z0 + 2
      const zB = foot.z1 - 2
      const doorZ = zA + 1 + rnd(Math.max(1, zB - zA - 1))
      for (let z = zA; z <= zB; z++) {
        for (let y = y0 + 1; y < y1; y++) {
          if (z === doorZ || z === doorZ + 1) continue
          if (grid[idx(px, y, z, sx, sy)] === BLOCK.empty) grid[idx(px, y, z, sx, sy)] = BLOCK.partition
        }
      }
    } else {
      const pz = foot.z0 + 2 + rnd(Math.max(1, spanZ - 3))
      const xA = foot.x0 + 2
      const xB = foot.x1 - 2
      const doorX = xA + 1 + rnd(Math.max(1, xB - xA - 1))
      for (let x = xA; x <= xB; x++) {
        for (let y = y0 + 1; y < y1; y++) {
          if (x === doorX || x === doorX + 1) continue
          if (grid[idx(x, y, pz, sx, sy)] === BLOCK.empty) grid[idx(x, y, pz, sx, sy)] = BLOCK.partition
        }
      }
    }
  }
}

/** Exposed roof deck = this story's ceiling cells not covered by the story above's footprint. */
function buildRails(grid: Uint8Array, sx: number, sy: number, sz: number, stories: Story[]) {
  for (let si = 0; si < stories.length; si++) {
    const cur = stories[si]!
    const above = stories[si + 1]
    const yCeil = cur.y1
    const yRail0 = yCeil + 1
    if (yRail0 >= sy) continue

    for (let z = cur.foot.z0; z <= cur.foot.z1; z++) {
      for (let x = cur.foot.x0; x <= cur.foot.x1; x++) {
        if (above && inFoot(above.foot, x, z)) continue // covered by box above
        // perimeter of exposed deck (neighbor missing or covered/outside)
        let edge = false
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx
          const nz = z + dz
          const inside = inFoot(cur.foot, nx, nz) && !(above && inFoot(above.foot, nx, nz))
          if (!inside) {
            edge = true
            break
          }
        }
        if (!edge) continue
        for (let y = yRail0; y < Math.min(sy, yRail0 + RAIL_H); y++) {
          if (grid[idx(x, y, z, sx, sy)] === BLOCK.empty) grid[idx(x, y, z, sx, sy)] = BLOCK.rail
        }
      }
    }
  }
}

function dressMargin(grid: Uint8Array, sx: number, sy: number, sz: number, stories: Story[]) {
  for (const { y0, y1, foot } of stories) {
    for (let n = 0; n < 4; n++) {
      const x = rnd(sx)
      const z = rnd(sz)
      if (inFoot(foot, x, z)) continue
      const y = y0 + 1 + rnd(Math.max(1, y1 - y0))
      if (y >= sy) continue
      if (grid[idx(x, y, z, sx, sy)] === BLOCK.empty) grid[idx(x, y, z, sx, sy)] = BLOCK.accent
    }
  }
}

/** Build uint8 haus grid for shape. */
export function generateHaus(sx: number, sy: number, sz: number): Uint8Array {
  const grid = new Uint8Array(sx * sy * sz)
  if (sx < 2 || sy < 2 || sz < 2) return grid

  const stories = rollStories(sx, sy, sz)
  if (!stories.length) return grid

  buildStructure(grid, sx, sy, stories)
  const fenestration = buildFenestration(sx, sy, sz, stories)
  applyOpenings(grid, fenestration, sx, sy, sz, stories)
  buildPartitions(grid, sx, sy, stories)
  buildRails(grid, sx, sy, sz, stories)
  dressMargin(grid, sx, sy, sz, stories)

  return grid
}

/** Temporary bridge — delete when uint16 dies. id 1..16 → legacy packed block. */
export function toUint16(id: number): number {
  if (id < 1 || id > 16) return 0
  const tint = id === BLOCK.accent ? 4 : id === BLOCK.floor ? 1 : id === BLOCK.rail ? 5 : 0
  return getBlockId(id - 1, tint)
}

function formatParcel(fieldU8: Uint8Array, shape: [number, number, number], parcel: Parcel) {
  const [sx, sy, sz] = shape
  if (!parcel.field || parcel.field.shape[0] !== sx || parcel.field.shape[1] !== sy || parcel.field.shape[2] !== sz) {
    parcel.field = ndarray(new Uint16Array(sx * sy * sz), [sx, sy, sz])
  }
  const out = parcel.field
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        out.set(x, y, z, toUint16(fieldU8[idx(x, y, z, sx, sy)]!))
      }
    }
  }
}

/** Nerf parcel with a seuss haus, patch, remesh. */
export async function spamhaus(parcel: Parcel) {
  const shape = parcel.fieldShape
  const [sx, sy, sz] = shape
  if (!sx || !sy || !sz) return

  const u8 = generateHaus(sx | 0, sy | 0, sz | 0)
  formatParcel(u8, [sx | 0, sy | 0, sz | 0], parcel)
  parcel.voxels = getVoxelsFromBuffer(parcel.field!.data.buffer)
  parcel.sendPatch({ voxels: parcel.voxels })
  await parcel.generate()
}
