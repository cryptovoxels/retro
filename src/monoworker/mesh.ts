// ABOUTME: Canonical voxel mesher - field to typed array buffers. Zero BABYLON. Worker only.

import ndarray, { type NdArray } from 'ndarray'
import { parseVox } from '../../common/vox/parse'
import type { VoxData } from '../../common/vox/types'
import { packPos, packRgb, VOX_SCALE, type MeshMeta } from '../../common/mesh/buf'
import { VoxelSize } from '../../common/voxels/constants'

export const GLASS = 2
const OPAQUE_BIT = 1 << 15
const VOXEL_MASK = (1 << 16) - 1
const AO_SCALE = 0.5
const AO_OFFSET = 0.4

export type Geo = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array; colorIndices: Float32Array; indices: Uint32Array }
export type GlassGeo = { positions: Float32Array; normals: Float32Array; colorIndices: Float32Array; indices: Uint32Array }
export type LightmapOut = { opaque: Geo; glass: GlassGeo | null }

// ─── helpers ──────────────────────────────────────────────────────────────────

export const LIGHT_SCALE = 0.25

const isGlass = (v: number) => v % 32 === GLASS
const passable = (v: number) => v === 0 || isGlass(v)

export function to8bit(field: NdArray<Uint16Array>): NdArray<Uint8Array> {
  const [w, h, d] = field.shape
  const out = ndarray(new Uint8Array(w * h * d), [w, h, d])
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        // keep glass (+ tint) so flood-fill can stain light
        out.set(x, y, z, field.get(x, y, z) & 0xff)
      }
    }
  }
  return out
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

function opaqueGeo(field: NdArray<Uint8Array>, light: Uint8Array): Geo {
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
  const colorIndices: number[] = []
  const indices: number[] = []
  const Y_OFFSET = 0.5

  let vi = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const cell = field.get(x, y, z)
        if (cell === 0 || isGlass(cell)) continue

        const layer = cell % 32
        const colorIndex = Math.floor(cell / 32) % 8
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

        const multiple = 1 / 1020 / LIGHT_SCALE

        for (const face of FACES) {
          const [nx, ny, nz] = face.ni
          const ax = x + nx,
            ay = y + ny,
            az = z + nz

          // neighbor out of bounds = exposed face; glass doesn't cull opaque faces
          const nv = ax >= 0 && ay >= 0 && az >= 0 && ax < w && ay < h && az < d ? field.get(ax, ay, az) : 0
          if (!passable(nv)) continue

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
            // lighting only - tint applied on main thread so palette drag is instant
            colors.push(sr * multiple, sg * multiple, sb * multiple, 1)
            colorIndices.push(colorIndex)
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
    colorIndices: new Float32Array(colorIndices),
    indices: new Uint32Array(indices),
  }
}

function glassGeo(field: NdArray<Uint8Array>): GlassGeo | null {
  const dims = field.shape
  const positions: number[] = []
  const normals: number[] = []
  const colorIndices: number[] = []
  const indices: number[] = []
  const Y_OFFSET = 0.5
  let vi = 0

  for (let f = 0; f < 6; f++) {
    const face = FACES[f]
    const axis = f >> 1
    const sign = f % 2 === 0 ? 1 : -1
    const au = (axis + 1) % 3
    const av = (axis + 2) % 3
    const du = dims[au]
    const dv = dims[av]
    const mask = new Int32Array(du * dv)
    const x = [0, 0, 0]

    for (let k = 0; k < dims[axis]; k++) {
      let n = 0
      for (let j = 0; j < dv; j++)
        for (let i = 0; i < du; i++, n++) {
          x[axis] = k
          x[au] = i
          x[av] = j
          const cell = field.get(x[0], x[1], x[2])
          if (!isGlass(cell)) {
            mask[n] = 0
            continue
          }
          x[axis] = k + sign
          const nv = x[axis] >= 0 && x[axis] < dims[axis] ? field.get(x[0], x[1], x[2]) : 0
          // only air exposes a glass face - opaque neighbours bury it
          mask[n] = nv === 0 ? (Math.floor(cell / 32) % 8) + 1 : 0
        }

      n = 0
      for (let j = 0; j < dv; j++)
        for (let i = 0; i < du; ) {
          const c = mask[n]
          if (!c) {
            i++
            n++
            continue
          }
          let w = 1
          while (i + w < du && mask[n + w] === c) w++
          let h = 1
          let done = false
          while (j + h < dv && !done) {
            for (let q = 0; q < w; q++)
              if (mask[n + q + h * du] !== c) {
                done = true
                break
              }
            if (!done) h++
          }
          for (let l = 0; l < h; l++) for (let q = 0; q < w; q++) mask[n + q + l * du] = 0

          for (const corner of face.v) {
            const p = [0, 0, 0]
            p[axis] = k + corner[axis]
            p[au] = i + corner[au] * w
            p[av] = j + corner[av] * h
            positions.push(p[0] * VoxelSize, p[1] * VoxelSize + Y_OFFSET, p[2] * VoxelSize)
            normals.push(...face.n)
            colorIndices.push(c - 1)
          }
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
          vi += 4

          i += w
          n += w
        }
    }
  }

  if (vi === 0) return null
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colorIndices: new Float32Array(colorIndices),
    indices: new Uint32Array(indices),
  }
}

// ─── entry points ─────────────────────────────────────────────────────────────

export function meshGeo(field8: NdArray<Uint8Array>, light: Uint8Array): LightmapOut {
  return { opaque: opaqueGeo(field8, light), glass: glassGeo(field8) }
}

const roundToNextHighestPowerOf2 = (v: number) => {
  v--
  v |= v >> 1
  v |= v >> 2
  v |= v >> 4
  v |= v >> 8
  v |= v >> 16
  v |= v >> 32
  return v + 1
}

const hash = (s: number): number => {
  let h = s
  h = (h ^ 12345391) * 2654435769
  h ^= (h << 6) ^ (h >> 26)
  h *= 2654435769
  h += (h << 5) ^ (h >> 12)
  return h >>> 0
}

const hashTableLookUp = (bucketData: Uint32Array, wrapMask: number, key_a: number, key_b: number): number => {
  let bucket_i = (hash(key_a) ^ hash(key_b)) & wrapMask
  while (true) {
    const i = bucket_i * 3
    if (bucketData[i] == key_a && bucketData[i + 1] == key_b) return bucketData[i + 2]
    if (bucketData[i] == 0) return bucket_i | 0x80000000
    bucket_i = (bucket_i + 1) & wrapMask
  }
}

function voxField(buffer: ArrayBuffer, megavox: boolean) {
  const vox = parseVox(buffer)
  if (vox.models.length > 1) throw new Error('Multiple models not supported yet')
  const originalSize = { ...vox.sizes[0] }
  const limit = megavox ? 128 + 128 + 128 : 32 + 32 + 32
  if (originalSize.x + originalSize.y + originalSize.z > limit) throw new Error('Larger .vox not supported yet')

  const size = { x: originalSize.x + 4, y: originalSize.y + 4, z: originalSize.z + 4 }
  const field = ndarray(new Uint16Array(size.x * size.y * size.z), [size.x, size.y, size.z])
  for (const row of vox.models[0]) {
    field.set(row.x + 1, row.y + 1, row.z + 1, row.colorIndex + OPAQUE_BIT)
  }
  return { field, originalSize, palette: vox.palette }
}

function vertexAO(s1: boolean, s2: boolean, c: boolean) {
  if (s1 && s2) return 1
  return 3 - (+s1 + +s2 + +c)
}

function cornerAo(field: NdArray<Uint16Array>, x: number, y: number, z: number, dx: number, dy: number, dz: number) {
  const s = (a: number, b: number, c: number) => ((field.get(a, b, c) || 0) & OPAQUE_BIT) !== 0
  return vertexAO(s(x - dx, y, z), s(x, y - dy, z), s(x, y, z - dz)) * 64 + 51
}

function meshVoxField(
  field: NdArray<Uint16Array>,
  originalSize: { x: number; y: number; z: number },
  palette: { r: number; g: number; b: number }[],
  flipX: boolean,
  wantCollider: boolean,
  colorMap?: Record<number, [number, number, number]>,
): VoxData {
  const [w, h, d] = field.shape
  const colorTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = palette[i] || { r: 0, g: 0, b: 0 }
    colorTable[i] = c.r | (c.g << 8) | (c.b << 16)
  }
  if (colorMap) {
    for (const [idx, rgb] of Object.entries(colorMap)) colorTable[+idx] = rgb[0] | (rgb[1] << 8) | (rgb[2] << 16)
  }

  const gran = (n: number) => Math.round(n * 1000) / 1000
  let fx = (x: number) => gran(0.02 * (x - originalSize.x / 2))
  let fy = (y: number) => gran(0.02 * (y - originalSize.y / 2))
  let fz = (z: number) => gran(0.02 * z)
  if (flipX) fx = (x) => gran(0.02 * (w - x - originalSize.x / 2))

  const meta: MeshMeta = { ox: 0, oy: 0, oz: 0, scale: VOX_SCALE }

  const maxVerts = w * h * d * 36
  const posArr = new Int8Array(maxVerts * 3)
  const rgbArr = new Uint8Array(maxVerts * 3)
  const indices: number[] = []
  const numBuckets = roundToNextHighestPowerOf2(Math.ceil(Math.max(maxVerts, 2) * 1.5))
  const wrapMask = numBuckets - 1
  const bucketData = new Uint32Array(numBuckets * 3)
  let next_v_i = 0

  const solid = (x: number, y: number, z: number) => ((field.get(x, y, z) || 0) & OPAQUE_BIT) !== 0
  const texAt = (x: number, y: number, z: number) => field.get(x, y, z) & 0xff

  const emit = (x: number, y: number, z: number, tex: number, ao: number): number => {
    const packedRgb = colorTable[tex] || 0
    const r = packedRgb & 0xff
    const g = (packedRgb >> 8) & 0xff
    const b = (packedRgb >> 16) & 0xff
    const key_a = x | (y << 8) | (z << 16) | (1 << 24)
    const key_b = packedRgb | ((ao & 240) << 20)
    const result = hashTableLookUp(bucketData, wrapMask, key_a, key_b)
    let v_i = 0
    if ((result & 0x80000000) == 0) {
      v_i = result
    } else {
      v_i = next_v_i++
      const bucket_i = result & 0x7fffffff
      bucketData[bucket_i * 3] = key_a
      bucketData[bucket_i * 3 + 1] = key_b
      bucketData[bucket_i * 3 + 2] = v_i
      const wx = fx(x)
      const wy = fz(z)
      const wz = -fy(y)
      packPos(posArr, v_i, wx, wy, wz, meta)
      packRgb(rgbArr, v_i, r, g, b, ao & 240)
    }
    return v_i
  }

  for (let x = 1; x < w - 1; x++) {
    for (let y = 1; y < h - 1; y++) {
      for (let z = 1; z < d - 1; z++) {
        if (!solid(x, y, z)) continue
        const tex = texAt(x, y, z)
        const neighbors = [
          [x + 1, y, z],
          [x - 1, y, z],
          [x, y + 1, z],
          [x, y - 1, z],
          [x, y, z + 1],
          [x, y, z - 1],
        ]
        const faceCorners = [
          [
            [x + 1, y, z + 1],
            [x + 1, y + 1, z + 1],
            [x + 1, y + 1, z],
            [x + 1, y, z],
          ],
          [
            [x, y, z],
            [x, y + 1, z],
            [x, y + 1, z + 1],
            [x, y, z + 1],
          ],
          [
            [x, y + 1, z],
            [x + 1, y + 1, z],
            [x + 1, y + 1, z + 1],
            [x, y + 1, z + 1],
          ],
          [
            [x, y, z + 1],
            [x + 1, y, z + 1],
            [x + 1, y, z],
            [x, y, z],
          ],
          [
            [x, y, z + 1],
            [x, y + 1, z + 1],
            [x + 1, y + 1, z + 1],
            [x + 1, y, z + 1],
          ],
          [
            [x + 1, y, z],
            [x + 1, y + 1, z],
            [x, y + 1, z],
            [x, y, z],
          ],
        ]
        for (let f = 0; f < 6; f++) {
          const [nx, ny, nz] = neighbors[f]
          if (solid(nx, ny, nz)) continue
          const corners = faceCorners[f]
          const cornerIdx: number[] = []
          for (let c = 0; c < 4; c++) {
            const p = corners[c]
            const ao = cornerAo(field, p[0], p[1], p[2], neighbors[f][0] - x, neighbors[f][1] - y, neighbors[f][2] - z)
            cornerIdx.push(emit(p[0], p[1], p[2], tex, ao))
          }
          const base = indices.length
          indices.push(cornerIdx[0], cornerIdx[1], cornerIdx[2], cornerIdx[0], cornerIdx[2], cornerIdx[3])
          if (!flipX) {
            const a = indices[base + 1]
            indices[base + 1] = indices[base + 2]
            indices[base + 2] = a
            const b = indices[base + 4]
            indices[base + 4] = indices[base + 5]
            indices[base + 5] = b
          }
        }
      }
    }
  }

  const numMergedVerts = next_v_i
  const finalIndices = numMergedVerts < 65536 ? Uint16Array.from(indices) : Uint32Array.from(indices)
  const out: VoxData = {
    pos: posArr.slice(0, numMergedVerts * 3),
    rgb: rgbArr.slice(0, numMergedVerts * 3),
    idx: finalIndices,
    meta,
    size: [originalSize.x, originalSize.y, originalSize.z],
  }

  if (wantCollider) {
    const colliderPositions: number[] = []
    const colliderIndices: number[] = []
    let vi = 0
    for (let x = 1; x < w - 1; x++) {
      for (let y = 1; y < h - 1; y++) {
        for (let z = 1; z < d - 1; z++) {
          if (!solid(x, y, z)) continue
          const neighbors = [
            [x + 1, y, z],
            [x - 1, y, z],
            [x, y + 1, z],
            [x, y - 1, z],
            [x, y, z + 1],
            [x, y, z - 1],
          ]
          const faceCorners = [
            [
              [x + 1, y, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y + 1, z],
              [x + 1, y, z],
            ],
            [
              [x, y, z],
              [x, y + 1, z],
              [x, y + 1, z + 1],
              [x, y, z + 1],
            ],
            [
              [x, y + 1, z],
              [x + 1, y + 1, z],
              [x + 1, y + 1, z + 1],
              [x, y + 1, z + 1],
            ],
            [
              [x, y, z + 1],
              [x + 1, y, z + 1],
              [x + 1, y, z],
              [x, y, z],
            ],
            [
              [x, y, z + 1],
              [x, y + 1, z + 1],
              [x + 1, y + 1, z + 1],
              [x + 1, y, z + 1],
            ],
            [
              [x + 1, y, z],
              [x + 1, y + 1, z],
              [x, y + 1, z],
              [x, y, z],
            ],
          ]
          for (let f = 0; f < 6; f++) {
            const [nx, ny, nz] = neighbors[f]
            if (solid(nx, ny, nz)) continue
            const corners = faceCorners[f]
            for (let c = 0; c < 3; c++) {
              const p = corners[c]
              colliderPositions.push(fx(p[0]), fz(p[2]), -fy(p[1]))
              colliderIndices.push(vi++)
            }
          }
        }
      }
    }
    out.colliderPositions = colliderPositions
    out.colliderIndices = colliderIndices
  }

  return out
}

export function meshVoxBuffer(buffer: ArrayBuffer, opts: { flipX: boolean; megavox: boolean; wantCollider: boolean; colorMap?: Record<number, [number, number, number]> }): VoxData {
  const { field, originalSize, palette } = voxField(buffer, opts.megavox)
  return meshVoxField(field, originalSize, palette, opts.flipX, opts.wantCollider, opts.colorMap)
}

export function meshLegacyField(data: Uint16Array, shape: [number, number, number], stride: number[], offset: number): LightmapOut {
  const field16 = ndarray(data, shape, stride, offset)
  const field8 = to8bit(field16)
  const [w, h, d] = field8.shape
  const pw = w + 2,
    ph = h + 2,
    pd = d + 2
  const light = new Uint8Array(pw * ph * pd * 6 * 3)
  const fill = 255 * LIGHT_SCALE
  for (let i = 0; i < light.length; i += 3) {
    light[i] = fill
    light[i + 1] = fill
    light[i + 2] = fill
  }
  return meshGeo(field8, light)
}
