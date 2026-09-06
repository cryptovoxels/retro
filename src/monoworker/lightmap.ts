// ABOUTME: Parcel lightmap bake - flood-fill lighting then mesh.ts geometry.

import ndarray, { type NdArray } from 'ndarray'
import { VoxelSize } from '../../common/voxels/constants'
import { GLASS, meshGeo, to8bit, type LightmapOut } from './mesh'

const DEBUG_LIGHT_PROBES = false

const isGlass = (v: number) => v % 32 === GLASS
const passable = (v: number) => v === 0 || isGlass(v)

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const S = 0.25
const K5000 = [255 * S, 250 * S, 240 * S] as const
const K4500 = [255 * S, 250 * S, 240 * S] as const
const K3800 = [240 * S, 230 * S, 210 * S] as const
const BOUNCE = [65 * S, 65 * S, 65 * S] as const

function floodfill(field: NdArray<Uint8Array>, lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>, off: [number, number, number], pal: [number, number, number][]): Uint8Array {
  const [w, h, d] = field.shape
  const pw = w + 2,
    ph = h + 2,
    pd = d + 2
  const rgb = new Uint8Array(pw * ph * pd * 6 * 3)

  const idx = (px: number, py: number, pz: number) => px + py * pw + pz * pw * ph

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

  const stain = (v: number, r: number, g: number, b: number): [number, number, number] => {
    if (!isGlass(v)) return [r, g, b]
    const p = pal[Math.floor(v / 32) % 8] || [1, 1, 1]
    return [Math.round(r * p[0]), Math.round(g * p[1]), Math.round(b * p[2])]
  }

  const queue: number[] = []
  const enqueue = (i: number, dir: number, r: number, g: number, b: number) => queue.push(i, dir, r, g, b)

  const seedP = (px: number, py: number, pz: number, r: number, g: number, b: number, dir: number) => {
    if (px < 0 || py < 0 || pz < 0 || px >= pw || py >= ph || pz >= pd) return
    const fx = px - 1,
      fy = py - 1,
      fz = pz - 1
    const inField = fx >= 0 && fy >= 0 && fz >= 0 && fx < w && fy < h && fz < d
    const fv = inField ? field.get(fx, fy, fz) : 0
    if (!passable(fv)) return
    const [sr, sg, sb] = stain(fv, r, g, b)
    const i = idx(px, py, pz)
    if (setMax(i, dir, sr, sg, sb)) enqueue(i, dir, sr, sg, sb)
  }

  if (DEBUG_LIGHT_PROBES) {
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, 0, 255, 255, 4)
        seedP(px, py, 0, 255, 0, 255, 5)
      }
    for (let px = 0; px < pw; px++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(px, ph - 1, pz, 0, 0, 255, 2)
        seedP(px, 4, pz, BOUNCE[0], BOUNCE[1], BOUNCE[2], 3)
      }
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, 255, 0, 0, 0)
        seedP(0, py, pz, 0, 255, 0, 1)
      }
  } else {
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, K5000[0], K5000[1], K5000[2], 4)
        seedP(px, py, 0, K3800[0], K3800[1], K3800[2], 5)
      }
    for (let px = 0; px < pw; px++) for (let pz = 0; pz < pd; pz++) seedP(px, ph - 1, pz, K4500[0], K4500[1], K4500[2], 2)
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, K5000[0], K5000[1], K5000[2], 0)
        seedP(0, py, pz, K3800[0], K3800[1], K3800[2], 1)
      }
  }

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
      if (d2 === (dirD ^ 1)) continue
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
      if (!passable(nv)) continue
      const ni = idx(nx, ny, nz)
      const [nr, ng, nb] = stain(nv, Math.round(cr * fall), Math.round(cg * fall), Math.round(cb * fall))
      if (nr > getC(ni, d2, 0) + 4 || ng > getC(ni, d2, 1) + 4 || nb > getC(ni, d2, 2) + 4) {
        if (setMax(ni, d2, nr, ng, nb)) enqueue(ni, d2, nr, ng, nb)
      }
    }
  }

  return rgb
}

export type { Geo, GlassGeo, LightmapOut } from './mesh'

export function bakeLightmap(
  data: Uint16Array,
  shape: [number, number, number],
  stride: number[],
  off2: number,
  lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>,
  off: [number, number, number],
  pal?: [number, number, number][],
): LightmapOut {
  const field16 = ndarray(data, shape, stride, off2)
  const field8 = to8bit(field16)
  const palette = pal?.length ? pal : Array.from({ length: 8 }, () => [1, 1, 1] as [number, number, number])
  const light = floodfill(field8, lanterns, off, palette)
  return meshGeo(field8, light)
}
