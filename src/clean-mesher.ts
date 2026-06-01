import ndarray, { type NdArray } from 'ndarray'
import { VoxelSize } from '../common/voxels/constants'
import type { LanternRecord } from '../common/messages/feature'
import { createGlassMaterial } from './materials/glass'

const DEBUG_LIGHT_PROBES = false

// ─── helpers ──────────────────────────────────────────────────────────────────

export function to8bit(field: NdArray<Uint16Array>): NdArray<Uint8Array> {
  const [w, h, d] = field.shape
  const out = ndarray(new Uint8Array(w * h * d), [w, h, d])
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) out.set(x, y, z, field.get(x, y, z) & 0xff)
  return out
}

let cachedTex: BABYLON.Texture | null = null
let cachedTexUrl = ''

function loadTex(url: string, scene: BABYLON.Scene): BABYLON.Texture {
  if (cachedTex && cachedTexUrl === url) return cachedTex
  cachedTex = new BABYLON.Texture(url, scene, false, false)
  cachedTexUrl = url
  return cachedTex
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

// returns Uint8Array of length (W+2)*(H+2)*(D+2)*3, padded by 1 voxel on every side.
// buildMesh samples via: (ax+1) + (ay+1)*(w+2) + (az+1)*(w+2)*(h+2)
export async function floodfill(field: NdArray<Uint8Array>, lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>, off: [number, number, number]): Promise<Uint8Array> {
  const [w, h, d] = field.shape
  const pw = w + 2,
    ph = h + 2,
    pd = d + 2
  const rgb = new Uint8Array(pw * ph * pd * 3)

  const idx = (px: number, py: number, pz: number) => px + py * pw + pz * pw * ph

  const getR = (i: number) => rgb[i * 3]
  const getG = (i: number) => rgb[i * 3 + 1]
  const getB = (i: number) => rgb[i * 3 + 2]

  const setMax = (i: number, r: number, g: number, b: number): boolean => {
    let changed = false
    if (r > rgb[i * 3]) {
      rgb[i * 3] = r
      changed = true
    }
    if (g > rgb[i * 3 + 1]) {
      rgb[i * 3 + 1] = g
      changed = true
    }
    if (b > rgb[i * 3 + 2]) {
      rgb[i * 3 + 2] = b
      changed = true
    }
    return changed
  }

  const queue: number[] = []

  // seed in padded space; border ring is always air
  const seedP = (px: number, py: number, pz: number, r: number, g: number, b: number) => {
    if (px < 0 || py < 0 || pz < 0 || px >= pw || py >= ph || pz >= pd) return
    const fx = px - 1,
      fy = py - 1,
      fz = pz - 1
    const inField = fx >= 0 && fy >= 0 && fz >= 0 && fx < w && fy < h && fz < d
    const fv = inField ? field.get(fx, fy, fz) : 0
    if (fv !== 0 && fv !== 2) return
    const i = idx(px, py, pz)
    if (setMax(i, r, g, b)) queue.push(i)
  }

  if (DEBUG_LIGHT_PROBES) {
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, 0, 255, 255) // +Z cyan
        seedP(px, py, 0, 255, 0, 255) // -Z pink
      }
    for (let px = 0; px < pw; px++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(px, ph - 1, pz, 0, 0, 255) // +Y blue
        seedP(px, 4, pz, BOUNCE[0], BOUNCE[1], BOUNCE[2]) // y=3 bounce
      }
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, 255, 0, 0) // +X red
        seedP(0, py, pz, 0, 255, 0) // -X green
      }
  } else {
    // Rayleigh-ish directional sky: +Z north / +X east cool, -Z south / -X west warm, top neutral
    for (let px = 0; px < pw; px++)
      for (let py = 0; py < ph; py++) {
        seedP(px, py, pd - 1, K5000[0], K5000[1], K5000[2]) // +Z north 5000K
        seedP(px, py, 0, K3800[0], K3800[1], K3800[2]) // -Z south 3800K
      }
    for (let px = 0; px < pw; px++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(px, ph - 1, pz, K4500[0], K4500[1], K4500[2]) // +Y top 4500K
        seedP(px, 4, pz, BOUNCE[0], BOUNCE[1], BOUNCE[2]) // y=3 dim warm bounce
      }
    for (let py = 0; py < ph; py++)
      for (let pz = 0; pz < pd; pz++) {
        seedP(pw - 1, py, pz, K5000[0], K5000[1], K5000[2]) // +X east 5000K
        seedP(0, py, pz, K3800[0], K3800[1], K3800[2]) // -X west 3800K
      }
  }

  // seed lanterns (field coords -> padded coords)
  for (const l of lanterns) {
    const [lx, ly, lz] = l.position
    // match voxelCoordFromPositionInParcel: subtract mesh offset + first-voxel center
    const fx = Math.floor((lx - off[0] - 0.25) / VoxelSize)
    const fy = Math.floor((ly - off[1] - 0.75) / VoxelSize)
    const fz = Math.floor((lz - off[2] - 0.25) / VoxelSize)
    const [lr, lg, lb] = hexToRgb(l.color || '#ffffff')
    const s = 1.0 // Math.min(1, Math.max(0, parseFloat(String(l.strength ?? 50)) / 100))

    seedP(fx + 1, fy + 1, fz + 1, Math.round(lr * s), Math.round(lg * s), Math.round(lb * s))
  }

  const FALL = 0.9
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
    const i = queue[head++]
    const pz = Math.floor(i / (pw * ph))
    const rem = i % (pw * ph)
    const py = Math.floor(rem / pw)
    const px = rem % pw

    const cr = getR(i)
    const cg = getG(i)
    const cb = getB(i)

    for (const [dx, dy, dz] of DIRS) {
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
      const nr = Math.round(cr * FALL)
      const ng = Math.round(cg * FALL)
      const nb = Math.round(cb * FALL)
      if (nr > getR(ni) + 4 || ng > getG(ni) + 4 || nb > getB(ni) + 4) {
        setMax(ni, nr, ng, nb)
        queue.push(ni)
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

export async function buildMesh(field: NdArray<Uint8Array>, light: Uint8Array, tex: BABYLON.Texture, scene: BABYLON.Scene, id: number, palette: BABYLON.Color3[]): Promise<BABYLON.Mesh> {
  const [w, h, d] = field.shape
  const pw = w + 2,
    ph = h + 2,
    pd = d + 2

  const sample = (px: number, py: number, pz: number): [number, number, number] => {
    if (px < 0 || py < 0 || pz < 0 || px >= pw || py >= ph || pz >= pd) return [0, 0, 0]
    const i = px + py * pw + pz * pw * ph
    return [light[i * 3], light[i * 3 + 1], light[i * 3 + 2]]
  }

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  let vi = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const cell = field.get(x, y, z)
        if (cell === 0) continue

        const layer = cell % 32
        const colorIndex = Math.floor(cell / 32) % 8
        const tint = palette[colorIndex] ?? palette[0]
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
            positions.push((x + vx) * VoxelSize, (y + vy) * VoxelSize, (z + vz) * VoxelSize)
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
            colors.push(sr * multiple * tint.r, sg * multiple * tint.g, sb * multiple * tint.b, 1)
          }

          uvs.push(u0, v0, u0, v1, u1, v1, u1, v0)

          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
          vi += 4
        }
      }
    }
  }

  const mesh = new BABYLON.Mesh(`voxelizer/opaque-${id}`, scene)

  const vd = new BABYLON.VertexData()
  vd.positions = new Float32Array(positions)
  vd.normals = new Float32Array(normals)
  vd.uvs = new Float32Array(uvs)
  vd.colors = new Float32Array(colors)
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(mesh)

  const mat = new BABYLON.StandardMaterial('clean-voxel-mat', scene)
  mat.diffuseTexture = tex
  // mat.emissiveColor = BABYLON.Color3.Black()
  // mat.disableLighting = true
  mesh.material = mat
  mat.specularColor.set(0.1, 0.05, 0.0)
  mat.specularPower = 42

  return mesh
}

function buildGlassMesh(field: NdArray<Uint8Array>, scene: BABYLON.Scene, id: number): BABYLON.Mesh | null {
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
  const mesh = new BABYLON.Mesh(`voxelizer/glass-${id}`, scene)
  const vd = new BABYLON.VertexData()
  vd.positions = new Float32Array(positions)
  vd.normals = new Float32Array(normals)
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(mesh)
  mesh.material = createGlassMaterial(scene, {})
  return mesh
}

// ─── entry point ──────────────────────────────────────────────────────────────

export async function buildCleanMesh(
  field: NdArray<Uint16Array>,
  lanterns: LanternRecord[],
  scene: BABYLON.Scene,
  off: [number, number, number],
  id: number,
  palette: BABYLON.Color3[],
  texOverride?: BABYLON.Texture,
): Promise<{ opaque: BABYLON.Mesh; glass: BABYLON.Mesh | null }> {
  const field8 = to8bit(field)
  const light = await floodfill(field8, lanterns as any, off)
  const url = DEBUG_LIGHT_PROBES ? '/textures/00-grid.png' : '/textures/atlas-ao.png'
  const tex = texOverride ?? loadTex(url, scene)
  const opaque = await buildMesh(field8, light, tex, scene, id, palette)
  const glass = buildGlassMesh(field8, scene, id)
  return { opaque, glass }
}
