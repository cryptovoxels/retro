import { VOX_SCALE } from '../../common/vox-import/vox-import'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const VoxTools = require('@sh-dave/format-vox').VoxTools

const rawPalette: number[] = VoxReader.get_DefaultPalette()
export const MAGICA_RGB: [number, number, number][] = rawPalette.map((c: number, i: number) => {
  if (i === 0) return [0, 0, 0]
  const col = VoxTools.transformColor(c)
  return [col.r, col.g, col.b]
})
Object.freeze(MAGICA_RGB)

const IMAGE_TYPES = new Set(['image', 'nft-image'])
const VOX_TYPES = new Set(['vox-model', 'megavox', 'ride'])

const IMAGE_DRAFT_B64 = 64 // 48 bytes raw RGB
const VOX_DRAFT_B64 = 92 // 67 bytes cells + size

const EPSILON = 0.01
const NUDGE_Z = -0.01
const CUBESCALE_MULT_X = 0.02
const CUBESCALE_MULT_Z = 0.065
const CUBESCALE_SCALE = 1 / (0.02 * 32) / 2

export type DraftJob = {
  uuid: string
  type: string
  draft?: string
  position?: [number, number, number] | { x: number; y: number; z: number }
  rotation?: [number, number, number] | { x: number; y: number; z: number }
  scale?: [number, number, number] | { x: number; y: number; z: number }
  cubescale?: boolean
  groupId?: string | null
}

export type DraftBuffers = {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
  ranges: Float32Array
  uuids: string[]
  matrices: Float32Array
  imageIndexEnd: number
}

function tidy(input: DraftJob['position']): [number, number, number] {
  if (!input) return [0, 0, 0]
  if (Array.isArray(input)) return [input[0] || 0, input[1] || 0, input[2] || 0]
  return [input.x || 0, input.y || 0, input.z || 0]
}

function b64ToBytes(b64: string): Uint8Array {
  // atob exists in workers; Buffer for node main-thread fallback
  if (typeof atob === 'function') {
    const s = atob(b64)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

// row-major 4x4, babylon layout (vectors as rows: v' = v * M)
function ident(): Float32Array {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function mul(a: Float32Array, b: Float32Array, out: Float32Array) {
  // out = a * b (row-major, row vectors: apply a then b)
  for (let row = 0; row < 4; row++) {
    const ai = row * 4
    const a0 = a[ai],
      a1 = a[ai + 1],
      a2 = a[ai + 2],
      a3 = a[ai + 3]
    out[ai] = a0 * b[0] + a1 * b[4] + a2 * b[8] + a3 * b[12]
    out[ai + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9] + a3 * b[13]
    out[ai + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10] + a3 * b[14]
    out[ai + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3 * b[15]
  }
}

// babylon euler YXZ on scaled basis: v' = v * S * R * T
function fromTRS(tx: number, ty: number, tz: number, rx: number, ry: number, rz: number, sx: number, sy: number, sz: number): Float32Array {
  const cx = Math.cos(rx),
    sx_ = Math.sin(rx)
  const cy = Math.cos(ry),
    sy_ = Math.sin(ry)
  const cz = Math.cos(rz),
    sz_ = Math.sin(rz)

  // R = Ry * Rx * Rz
  const r00 = cy * cz + sy_ * sx_ * sz_
  const r01 = -cy * sz_ + sy_ * sx_ * cz
  const r02 = sy_ * cx
  const r10 = cx * sz_
  const r11 = cx * cz
  const r12 = -sx_
  const r20 = -sy_ * cz + cy * sx_ * sz_
  const r21 = sy_ * sz_ + cy * sx_ * cz
  const r22 = cy * cx

  const m = new Float32Array(16)
  // columns are the basis vectors (written into rows of the flat array for row-vector mul)
  m[0] = r00 * sx
  m[1] = r10 * sx
  m[2] = r20 * sx
  m[3] = 0
  m[4] = r01 * sy
  m[5] = r11 * sy
  m[6] = r21 * sy
  m[7] = 0
  m[8] = r02 * sz
  m[9] = r12 * sz
  m[10] = r22 * sz
  m[11] = 0
  m[12] = tx
  m[13] = ty
  m[14] = tz
  m[15] = 1
  return m
}

function translateLocalZ(m: Float32Array, z: number) {
  // post-multiply T(0,0,z): row vectors -> M' = M * T
  m[12] += m[8] * z
  m[13] += m[9] * z
  m[14] += m[10] * z
}

function transformPoint(m: Float32Array, x: number, y: number, z: number, out: Float32Array, oi: number) {
  out[oi] = x * m[0] + y * m[4] + z * m[8] + m[12]
  out[oi + 1] = x * m[1] + y * m[5] + z * m[9] + m[13]
  out[oi + 2] = x * m[2] + y * m[6] + z * m[10] + m[14]
}

function leafMatrix(job: DraftJob, isImage: boolean): Float32Array {
  const pos = tidy(job.position)
  const rot = tidy(job.rotation)
  let scale = tidy(job.scale)
  let sx = scale[0] || EPSILON
  let sy = scale[1] || EPSILON
  let sz = isImage ? 1 : scale[2] || EPSILON
  let px = pos[0],
    py = pos[1],
    pz = pos[2]

  if (!isImage && job.cubescale) {
    sx *= CUBESCALE_SCALE
    sy *= CUBESCALE_SCALE
    sz *= CUBESCALE_SCALE
    px += CUBESCALE_MULT_X * (scale[0] || 0)
    pz += CUBESCALE_MULT_Z * (scale[2] || 0)
  }

  const m = fromTRS(px, py, pz, rot[0], rot[1], rot[2], sx, sy, sz)
  translateLocalZ(m, NUDGE_Z)
  return m
}

function chainMatrix(job: DraftJob, byUuid: Map<string, DraftJob>, isImage: boolean): Float32Array {
  // parent chain first (root -> leaf), each leaf's own TRS relative to parent
  const chain: DraftJob[] = []
  let cur: DraftJob | undefined = job
  const seen = new Set<string>()
  while (cur) {
    chain.push(cur)
    if (!cur.groupId || seen.has(cur.groupId)) break
    seen.add(cur.groupId)
    cur = byUuid.get(cur.groupId)
  }
  chain.reverse()

  let acc = ident()
  const tmp = new Float32Array(16)
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    const leaf = node === job ? leafMatrix(node, isImage) : leafMatrix(node, false)
    // childWorld = childLocal * parentWorld
    mul(leaf, acc, tmp)
    acc.set(tmp)
  }
  return acc
}

// unit plane facing +Z, size 1, centred at origin. split into 4x4 coloured quads
function countImage(bytes: Uint8Array) {
  return { verts: 64, indices: 96 }
}

function writeImage(bytes: Uint8Array, positions: Float32Array, colors: Float32Array, indices: Uint32Array, vertBase: number, indexBase: number, matrix: Float32Array | null) {
  const cell = 0.25
  let vi = vertBase
  let ii = indexBase
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const pi = (row * 4 + col) * 3
      const r = bytes[pi] / 255
      const g = bytes[pi + 1] / 255
      const b = bytes[pi + 2] / 255
      // top row first in the draft; plane Y goes up, so row 0 is y=+0.5
      const x0 = -0.5 + col * cell
      const x1 = x0 + cell
      const y1 = 0.5 - row * cell
      const y0 = y1 - cell
      const corners: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]
      const base = vi
      for (let c = 0; c < 4; c++) {
        const [x, y] = corners[c]
        const oi = vi * 3
        if (matrix) transformPoint(matrix, x, y, 0, positions, oi)
        else {
          positions[oi] = x
          positions[oi + 1] = y
          positions[oi + 2] = 0
        }
        colors[vi * 4] = r
        colors[vi * 4 + 1] = g
        colors[vi * 4 + 2] = b
        colors[vi * 4 + 3] = 1
        vi++
      }
      // ccw when viewed from +Z
      indices[ii++] = base
      indices[ii++] = base + 1
      indices[ii++] = base + 2
      indices[ii++] = base
      indices[ii++] = base + 2
      indices[ii++] = base + 3
    }
  }
  return { verts: 64, indices: 96 }
}

function countVox(bytes: Uint8Array) {
  let n = 0
  for (let i = 0; i < 64; i++) if (bytes[i]) n++
  return { verts: n * 24, indices: n * 36 }
}

// box corners: 8 verts, but we emit 24 (unique normals per face) like CreateBox
const BOX_FACES: { n: [number, number, number]; q: [number, number, number][] }[] = [
  // +Y
  {
    n: [0, 1, 0],
    q: [
      [-1, 1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  // -Y
  {
    n: [0, -1, 0],
    q: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, -1, -1],
    ],
  },
  // +X
  {
    n: [1, 0, 0],
    q: [
      [1, -1, -1],
      [1, -1, 1],
      [1, 1, 1],
      [1, 1, -1],
    ],
  },
  // -X
  {
    n: [-1, 0, 0],
    q: [
      [-1, -1, 1],
      [-1, -1, -1],
      [-1, 1, -1],
      [-1, 1, 1],
    ],
  },
  // +Z
  {
    n: [0, 0, 1],
    q: [
      [1, -1, 1],
      [-1, -1, 1],
      [-1, 1, 1],
      [1, 1, 1],
    ],
  },
  // -Z
  {
    n: [0, 0, -1],
    q: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
]

function writeVox(bytes: Uint8Array, positions: Float32Array, colors: Float32Array, indices: Uint32Array, vertBase: number, indexBase: number, matrix: Float32Array | null) {
  const cellX = ((bytes[64] || 1) / 4) * VOX_SCALE
  const cellY = ((bytes[66] || 1) / 4) * VOX_SCALE
  const cellZ = ((bytes[65] || 1) / 4) * VOX_SCALE
  const hx = cellX * 0.95 * 0.5
  const hy = cellY * 0.95 * 0.5
  const hz = cellZ * 0.95 * 0.5

  let vi = vertBase
  let ii = indexBase
  let boxes = 0

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const pi = bytes[x + y * 4 + z * 16]
        if (!pi) continue
        const [cr, cg, cb] = MAGICA_RGB[pi] || MAGICA_RGB[1]
        const r = cr / 255
        const g = cg / 255
        const b = cb / 255
        // same layout as renderVoxDraft: mirrored x, vox z up, base on y=0, x/z centred
        const cx = (1.5 - x) * cellX
        const cy = (z + 0.5) * cellY
        const cz = (1.5 - y) * cellZ

        for (const face of BOX_FACES) {
          const base = vi
          for (const q of face.q) {
            const lx = cx + q[0] * hx
            const ly = cy + q[1] * hy
            const lz = cz + q[2] * hz
            const oi = vi * 3
            if (matrix) transformPoint(matrix, lx, ly, lz, positions, oi)
            else {
              positions[oi] = lx
              positions[oi + 1] = ly
              positions[oi + 2] = lz
            }
            colors[vi * 4] = r
            colors[vi * 4 + 1] = g
            colors[vi * 4 + 2] = b
            colors[vi * 4 + 3] = 1
            vi++
          }
          indices[ii++] = base
          indices[ii++] = base + 1
          indices[ii++] = base + 2
          indices[ii++] = base
          indices[ii++] = base + 2
          indices[ii++] = base + 3
        }
        boxes++
      }
    }
  }
  return { verts: boxes * 24, indices: boxes * 36 }
}

export function meshDrafts(jobs: DraftJob[], bake: boolean): DraftBuffers {
  const byUuid = new Map<string, DraftJob>()
  for (const j of jobs) if (j.uuid) byUuid.set(j.uuid, j)

  type Item = { job: DraftJob; bytes: Uint8Array; isImage: boolean }
  const images: Item[] = []
  const voxes: Item[] = []

  for (const job of jobs) {
    if (!job.draft || !job.uuid) continue
    const isImage = IMAGE_TYPES.has(job.type)
    const isVox = VOX_TYPES.has(job.type)
    if (!isImage && !isVox) continue
    if (isImage && job.draft.length !== IMAGE_DRAFT_B64) continue
    if (isVox && job.draft.length !== VOX_DRAFT_B64) continue
    const bytes = b64ToBytes(job.draft)
    if (isImage && bytes.length !== 48) continue
    if (isVox && bytes.length !== 67) continue
    ;(isImage ? images : voxes).push({ job, bytes, isImage })
  }

  const items = images.concat(voxes)
  let vertCount = 0
  let indexCount = 0
  const sizes: { verts: number; indices: number }[] = []
  for (const it of items) {
    const s = it.isImage ? countImage(it.bytes) : countVox(it.bytes)
    sizes.push(s)
    vertCount += s.verts
    indexCount += s.indices
  }

  const positions = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 4)
  const indices = new Uint32Array(indexCount)
  const ranges = new Float32Array(items.length * 4)
  const matrices = new Float32Array(items.length * 16)
  const uuids: string[] = []

  let vertBase = 0
  let indexBase = 0
  let imageIndexEnd = 0

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const matrix = bake ? chainMatrix(it.job, byUuid, it.isImage) : null
    const leaf = leafMatrix(it.job, it.isImage)
    matrices.set(leaf, i * 16)

    const written = it.isImage ? writeImage(it.bytes, positions, colors, indices, vertBase, indexBase, matrix) : writeVox(it.bytes, positions, colors, indices, vertBase, indexBase, matrix)

    ranges[i * 4] = vertBase
    ranges[i * 4 + 1] = written.verts
    ranges[i * 4 + 2] = indexBase
    ranges[i * 4 + 3] = written.indices
    uuids.push(it.job.uuid)

    vertBase += written.verts
    indexBase += written.indices
    if (it.isImage) imageIndexEnd = indexBase
  }

  return { positions, colors, indices, ranges, uuids, matrices, imageIndexEnd }
}
