// ABOUTME: Pure lightmap bake - to8bit + flood-fill lighting + voxel geometry generation.
// ABOUTME: Zero BABYLON. Runs inside the monoworker; main thread turns the arrays into meshes.

import ndarray, { type NdArray } from 'ndarray'
import { VoxelSize } from '../../common/voxels/constants'

const DEBUG_LIGHT_PROBES = false
export const GLASS = 2

export type Geo = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array }
export type GlassGeo = { positions: Float32Array; normals: Float32Array; indices: Uint32Array }
export type LightmapOut = { opaque: Geo; glass: GlassGeo | null }

// ─── helpers ──────────────────────────────────────────────────────────────────

function to8bit(field: NdArray<Uint16Array>): NdArray<Uint8Array> {
  const [w, h, d] = field.shape
  const out = ndarray(new Uint8Array(w * h * d), [w, h, d])
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const v = field.get(x, y, z) & 0xff

        if (v != GLASS) {
          out.set(x, y, z, v)
        }
      }
    }
  }
  return out
}

// ─── lighting ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Sky strength
const S = 0.25

// approximate Kelvin colors for directional sky seeds
const K5000 = [255 * S, 250 * S, 240 * S] as const // cool - north (+Z) / east (+X)
const K4500 = [255 * S, 250 * S, 240 * S] as const // neutral - top (+Y)
const K3800 = [240 * S, 230 * S, 210 * S] as const // warm - south (-Z) / west (-X)
const BOUNCE = [65 * S, 65 * S, 65 * S] as const // dim warm bounce (3800K @ 35%)

// Direction indices match DIRS order below: 0=[-1,0,0] 1=[+1,0,0] 2=[0,-1,0] 3=[0,+1,0] 4=[0,0,-1] 5=[0,0,+1]
// Opposite of direction d is d^1 (pairs 0↔1, 2↔3, 4↔5)
//
// returns Uint8Array of length (W+2)*(H+2)*(D+2)*6*3 - 6 directional slots per cell.
// buildMesh sums all 6 slots when sampling light.
function floodfill(field: NdArray<Uint8Array>, lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>, off: [number, number, number]): Uint8Array {
  const [w, h, d] = field.shape
  const pw = w + 2,
    ph = h + 2,
    pd = d + 2
  const rgb = new Uint8Array(pw * ph * pd * 6 * 3)

  const idx = (px: number, py: number, pz: number) => px + py * pw + pz * pw * ph

  // per-direction slot accessors
  const getC = (i: number, dir: number, ch: number) => rgb[(i * 6 + dir) * 3 + ch]
  const setMax = (i: number, dir: number, r: number, g: number, b: number): boolean => {
    const base = (i * 6 + dir) * 3
    let changed = false
    if (r > rgb[base]) {
      rgb[base] = r
      changed = true
    }
    if (g > rgb[base + 1]) {
      rgb[base + 1] = g
      changed = true
    }
    if (b > rgb[base + 2]) {
      rgb[base + 2] = b
      changed = true
    }
    return changed
  }

  // flat queue: 5 values per entry [cellIdx, dirIdx, r, g, b]
  const queue: number[] = []
  const enqueue = (i: number, dir: number, r: number, g: number, b: number) => queue.push(i, dir, r, g, b)

  // seed in padded space; border ring is always air; dir is the direction of travel (into the parcel)
  const seedP = (px: number, py: number, pz: number, r: number, g: number, b: number, dir: number) => {
    if (px < 0 || py < 0 || pz < 0 || px >= pw || py >= ph || pz >= pd) return
    const fx = px - 1,
      fy = py - 1,
      fz = pz - 1
    const inField = fx >= 0 && fy >= 0 && fz >= 0 && fx < w && fy < h && fz < d
    const fv = inField ? field.get(fx, fy, fz) : 0
    if (fv !== 0 && fv !== 2) return
    const i = idx(px, py, pz)
    if (setMax(i, dir, r, g, b)) enqueue(i, dir, r, g, b)
  }

  if (DEBUG_LIGHT_PROBES) {
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, 0, 255, 255, 4) // +Z face -> travel -Z (dir 4): cyan
        seedP(px, py, 0, 255, 0, 255, 5) // -Z face -> travel +Z (dir 5): pink
      }
    for (let px = 0; px < pw; px++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(px, ph - 1, pz, 0, 0, 255, 2) // +Y face -> travel -Y (dir 2): blue
        seedP(px, 4, pz, BOUNCE[0], BOUNCE[1], BOUNCE[2], 3) // bounce -> travel +Y (dir 3)
      }
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, 255, 0, 0, 0) // +X face -> travel -X (dir 0): red
        seedP(0, py, pz, 0, 255, 0, 1) // -X face -> travel +X (dir 1): green
      }
  } else {
    // Rayleigh-ish directional sky: each border face seeds its single inward direction
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, K5000[0], K5000[1], K5000[2], 4) // +Z -> -Z
        seedP(px, py, 0, K3800[0], K3800[1], K3800[2], 5) // -Z -> +Z
      }
    for (let px = 0; px < pw; px++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(px, ph - 1, pz, K4500[0], K4500[1], K4500[2], 2) // +Y -> -Y
      }
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, K5000[0], K5000[1], K5000[2], 0) // +X -> -X
        seedP(0, py, pz, K3800[0], K3800[1], K3800[2], 1) // -X -> +X
      }
  }

  // lanterns are point sources - emit into all 6 direction slots
  for (const l of lanterns) {
    const [lx, ly, lz] = l.position
    const fx = Math.floor((lx - off[0] - 0.25) / VoxelSize)
    const fy = Math.floor((ly - off[1] - 0.75) / VoxelSize)
    const fz = Math.floor((lz - off[2] - 0.25) / VoxelSize)
    const [lr, lg, lb] = hexToRgb(l.color || '#ffffff')
    const s = Math.min(1, Math.max(0, parseFloat(String(l.strength ?? 50)) / 100))
    const r = Math.round(lr * s),
      g = Math.round(lg * s),
      b = Math.round(lb * s)
    for (let dir = 0; dir < 6; dir++) seedP(fx + 1, fy + 1, fz + 1, r, g, b, dir)
  }

  const DIRS = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ] as const

  let head = 0
  while (head < queue.length) {
    const i = queue[head]
    const dirD = queue[head + 1]
    const cr = queue[head + 2]
    const cg = queue[head + 3]
    const cb = queue[head + 4]
    head += 5

    const pz = Math.floor(i / (pw * ph))
    const rem = i % (pw * ph)
    const py = Math.floor(rem / pw)
    const px = rem % pw

    for (let d2 = 0; d2 < 6; d2++) {
      if (d2 === (dirD ^ 1)) continue // blocked: backward direction
      const fall = d2 === dirD ? 0.9 : 0.6
      const [dx, dy, dz] = DIRS[d2]
      const nx = px + dx,
        ny = py + dy,
        nz = pz + dz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= pw || ny >= ph || nz >= pd) continue
      const fx = nx - 1,
        fy = ny - 1,
        fz = nz - 1
      const inField = fx >= 0 && fy >= 0 && fz >= 0 && fx < w && fy < h && fz < d
      const nv = inField ? field.get(fx, fy, fz) : 0
      if (nv !== 0 && nv !== 2) continue
      const ni = idx(nx, ny, nz)
      const nr = Math.round(cr * fall)
      const ng = Math.round(cg * fall)
      const nb = Math.round(cb * fall)
      if (nr > getC(ni, d2, 0) + 4 || ng > getC(ni, d2, 1) + 4 || nb > getC(ni, d2, 2) + 4) {
        if (setMax(ni, d2, nr, ng, nb)) enqueue(ni, d2, nr, ng, nb)
      }
    }
  }

  return rgb
}

// ─── meshing ──────────────────────────────────────────────────────────────────

const ATLAS_COLS = 4

// face defs: [normal, 4 corner offsets (dx,dy,dz)]
// corners ordered so front-face winding is correct (CCW from outside)
const FACES: Array<{
  n: [number, number, number]
  v: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
  ni: [number, number, number]
}> = [
  {
    n: [1, 0, 0],
    ni: [1, 0, 0],
    v: [
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  {
    n: [-1, 0, 0],
    ni: [-1, 0, 0],
    v: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    n: [0, 1, 0],
    ni: [0, 1, 0],
    v: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    n: [0, -1, 0],
    ni: [0, -1, 0],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    n: [0, 0, 1],
    ni: [0, 0, 1],
    v: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    n: [0, 0, -1],
    ni: [0, 0, -1],
    v: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
]

function opaqueGeo(field: NdArray<Uint8Array>, light: Uint8Array, pal: [number, number, number][]): Geo {
  const [w, h, d] = field.shape
  const pw = w + 2,
    ph = h + 2

  const sample = (px: number, py: number, pz: number): [number, number, number] => {
    if (px < 0 || py < 0 || pz < 0 || px >= pw || py >= ph || pz >= d + 2) return [0, 0, 0]
    const i = px + py * pw + pz * pw * ph
    let r = 0,
      g = 0,
      b = 0
    for (let dir = 0; dir < 6; dir++) {
      const base = (i * 6 + dir) * 3
      r += light[base]
      g += light[base + 1]
      b += light[base + 2]
    }
    return [Math.min(255, r), Math.min(255, g), Math.min(255, b)]
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const Y_OFFSET = 0.5

  let vi = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const cell = field.get(x, y, z)
        if (cell === 0) continue

        const layer = cell % 32
        const colorIndex = Math.floor(cell / 32) % 8
        const tint = pal[colorIndex] ?? pal[0]
        const col = layer % ATLAS_COLS
        const row = Math.floor(layer / ATLAS_COLS)
        let u0 = col / ATLAS_COLS,
          u1 = (col + 1) / ATLAS_COLS
        let v0 = row / ATLAS_COLS,
          v1 = (row + 1) / ATLAS_COLS

        const margin = 0.188
        u0 += margin
        v0 += margin
        u1 -= margin
        v1 -= margin

        const multiple = 1 / 1020 / S

        for (const face of FACES) {
          const [nx, ny, nz] = face.ni
          const ax = x + nx,
            ay = y + ny,
            az = z + nz

          // neighbor out of bounds = exposed face; glass (2) doesn't cull opaque faces
          const nv = ax >= 0 && ay >= 0 && az >= 0 && ax < w && ay < h && az < d ? field.get(ax, ay, az) : 0
          if (nv !== 0 && nv !== 2) continue

          // air cell in front of this face (padded), and the 2 tangent axes of the face plane
          const base = [ax + 1, ay + 1, az + 1]
          const tans = [0, 1, 2].filter((a) => face.n[a] === 0)
          const ta = tans[0],
            tb = tans[1]

          for (const [vx, vy, vz] of face.v) {
            positions.push((x + vx) * VoxelSize, (y + vy) * VoxelSize + Y_OFFSET, (z + vz) * VoxelSize)
            normals.push(...face.n)

            // average the 4 air cells in the face plane that touch this corner (smooth light)
            const vc = [vx, vy, vz]
            const oa = vc[ta] === 0 ? [-1, 0] : [0, 1]
            const ob = vc[tb] === 0 ? [-1, 0] : [0, 1]
            let sr = 0,
              sg = 0,
              sb = 0
            for (const da of oa)
              for (const db of ob) {
                const p = [base[0], base[1], base[2]]
                p[ta] += da
                p[tb] += db
                const [r, g, b] = sample(p[0], p[1], p[2])
                sr += r
                sg += g
                sb += b
              }
            colors.push(sr * multiple * tint[0], sg * multiple * tint[1], sb * multiple * tint[2], 1)
          }

          uvs.push(u0, v0, u0, v1, u1, v1, u1, v0)

          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
          vi += 4
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  }
}

function glassGeo(field: NdArray<Uint8Array>): GlassGeo | null {
  const [w, h, d] = field.shape
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let vi = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        if (field.get(x, y, z) !== 2) continue
        for (const face of FACES) {
          const [nx, ny, nz] = face.ni
          const ax = x + nx,
            ay = y + ny,
            az = z + nz
          const nv = ax >= 0 && ay >= 0 && az >= 0 && ax < w && ay < h && az < d ? field.get(ax, ay, az) : 0
          if (nv === 2) continue // cull glass-glass shared faces
          for (const [vx, vy, vz] of face.v) {
            positions.push((x + vx) * VoxelSize, (y + vy) * VoxelSize, (z + vz) * VoxelSize)
            normals.push(...face.n)
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
          vi += 4
        }
      }
    }
  }

  if (vi === 0) return null
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) }
}

// ─── entry point ──────────────────────────────────────────────────────────────

export function bakeLightmap(
  data: Uint16Array,
  shape: [number, number, number],
  stride: number[],
  off2: number,
  lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>,
  off: [number, number, number],
  pal: [number, number, number][],
): LightmapOut {
  const field16 = ndarray(data, shape, stride, off2)
  const field8 = to8bit(field16)
  const light = floodfill(field8, lanterns, off)
  return { opaque: opaqueGeo(field8, light, pal), glass: glassGeo(field8) }
}
