import ndarray, { type NdArray } from 'ndarray'
import { VoxelSize } from '../common/voxels/constants'
import type { LanternRecord } from '../common/messages/feature'

// ─── helpers ──────────────────────────────────────────────────────────────────

export function to8bit(field: NdArray<Uint16Array>): NdArray<Uint8Array> {
  const [w, h, d] = field.shape
  const out = ndarray(new Uint8Array(w * h * d), [w, h, d])
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++)
        out.set(x, y, z, field.get(x, y, z) & 0xff)
  return out
}

let cachedTexArray: BABYLON.RawTexture2DArray | null = null
let cachedTexUrl = ''

export async function atlasToTextureArray(url: string, scene: BABYLON.Scene): Promise<BABYLON.RawTexture2DArray> {
  if (cachedTexArray && cachedTexUrl === url) return cachedTexArray

  const resp = await fetch(url)
  const blob = await resp.blob()
  const bmp = await createImageBitmap(blob)

  const tileSize = 128
  const cols = 4
  const rows = 4
  const layers = cols * rows

  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)

  const out = new Uint8Array(tileSize * tileSize * 4 * layers)
  for (let i = 0; i < layers; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const px = ctx.getImageData(col * tileSize, row * tileSize, tileSize, tileSize)
    out.set(px.data, i * tileSize * tileSize * 4)
  }

  cachedTexArray = new BABYLON.RawTexture2DArray(out, tileSize, tileSize, layers, BABYLON.Constants.TEXTUREFORMAT_RGBA, scene, false, false, BABYLON.Constants.TEXTURE_BILINEAR_SAMPLINGMODE)
  cachedTexUrl = url
  return cachedTexArray
}

// ─── lighting ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

// returns Uint8Array of length W*H*D*3, interleaved RGB per voxel (0-255)
export function floodfill(
  field: NdArray<Uint8Array>,
  lanterns: Array<{ position: [number, number, number]; color: string; strength?: number | string }>,
): Uint8Array {
  const [w, h, d] = field.shape
  const size = w * h * d
  const rgb = new Uint8Array(size * 3)

  const idx = (x: number, y: number, z: number) => x + y * w + z * w * h

  const getR = (i: number) => rgb[i * 3]
  const getG = (i: number) => rgb[i * 3 + 1]
  const getB = (i: number) => rgb[i * 3 + 2]

  const setMax = (i: number, r: number, g: number, b: number): boolean => {
    let changed = false
    if (r > rgb[i * 3]) { rgb[i * 3] = r; changed = true }
    if (g > rgb[i * 3 + 1]) { rgb[i * 3 + 1] = g; changed = true }
    if (b > rgb[i * 3 + 2]) { rgb[i * 3 + 2] = b; changed = true }
    return changed
  }

  const queue: number[] = []

  const seed = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return
    if (field.get(x, y, z) !== 0) return
    const i = idx(x, y, z)
    if (setMax(i, r, g, b)) queue.push(i)
  }

  // seed 5 boundary faces (all except -Z face, z=0)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      seed(x, y, d - 1, 255, 255, 255)   // +Z face
    }
  }
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      seed(x, h - 1, z, 255, 255, 255)   // +Y face
      seed(x, 0, z, 255, 255, 255)       // -Y face
    }
  }
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      seed(w - 1, y, z, 255, 255, 255)   // +X face
      seed(0, y, z, 255, 255, 255)       // -X face
    }
  }

  // seed lanterns
  for (const l of lanterns) {
    const [lx, ly, lz] = l.position
    const vx = Math.floor(lx / VoxelSize)
    const vy = Math.floor(ly / VoxelSize)
    const vz = Math.floor(lz / VoxelSize)
    const [lr, lg, lb] = hexToRgb(l.color || '#ffffff')
    const s = Math.min(1, Math.max(0, parseFloat(String(l.strength ?? 50)) / 100))
    seed(vx, vy, vz, Math.round(lr * s), Math.round(lg * s), Math.round(lb * s))
  }

  const FALL = 0.8
  const DIRS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const

  let head = 0
  while (head < queue.length) {
    const i = queue[head++]
    const z = Math.floor(i / (w * h))
    const rem = i % (w * h)
    const y = Math.floor(rem / w)
    const x = rem % w

    const cr = getR(i)
    const cg = getG(i)
    const cb = getB(i)

    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= d) continue
      if (field.get(nx, ny, nz) !== 0) continue
      const ni = idx(nx, ny, nz)
      const nr = Math.round(cr * FALL)
      const ng = Math.round(cg * FALL)
      const nb = Math.round(cb * FALL)
      // only push if at least one channel meaningfully improves
      if (nr > getR(ni) + 4 || ng > getG(ni) + 4 || nb > getB(ni) + 4) {
        setMax(ni, nr, ng, nb)
        queue.push(ni)
      }
    }
  }

  return rgb
}

// ─── shaders ──────────────────────────────────────────────────────────────────

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute float texLayer;
attribute vec3 lightRgb;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUv;
varying float vLayer;
varying vec3 vLight;
void main() {
  vUv = uv;
  vLayer = texLayer;
  vLight = lightRgb;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`

const FRAG = `
precision highp float;
uniform sampler2DArray tiles;
varying vec2 vUv;
varying float vLayer;
varying vec3 vLight;
void main() {
  vec4 col = texture(tiles, vec3(vUv, vLayer));
  gl_FragColor = vec4(col.rgb * vLight, col.a);
}
`

// ─── meshing ──────────────────────────────────────────────────────────────────

// face defs: [normal, 4 corner offsets (dx,dy,dz)]
// corners ordered so front-face winding is correct (CCW from outside)
const FACES: Array<{
  n: [number, number, number]
  v: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
  ni: [number, number, number]
}> = [
    // +X
    { n: [1, 0, 0], ni: [1, 0, 0], v: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]] },
    // -X
    { n: [-1, 0, 0], ni: [-1, 0, 0], v: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
    // +Y
    { n: [0, 1, 0], ni: [0, 1, 0], v: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
    // -Y
    { n: [0, -1, 0], ni: [0, -1, 0], v: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] },
    // +Z
    { n: [0, 0, 1], ni: [0, 0, 1], v: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
    // -Z
    { n: [0, 0, -1], ni: [0, 0, -1], v: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]] },
  ]

export function buildMesh(
  field: NdArray<Uint8Array>,
  light: Uint8Array,
  texArray: BABYLON.RawTexture2DArray,
  scene: BABYLON.Scene,
): BABYLON.Mesh {
  const [w, h, d] = field.shape

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const texLayerAttr: number[] = []
  const lightRgbAttr: number[] = []

  const idx = (x: number, y: number, z: number) => x + y * w + z * w * h

  let vi = 0

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        const cell = field.get(x, y, z)
        if (cell === 0) continue

        const texLayer = cell % 32

        for (const face of FACES) {
          const [nx, ny, nz] = face.ni
          const ax = x + nx, ay = y + ny, az = z + nz

          // neighbor out of bounds = exposed face
          const neighborSolid = ax >= 0 && ay >= 0 && az >= 0 && ax < w && ay < h && az < d
            ? field.get(ax, ay, az) !== 0
            : false

          if (neighborSolid) continue

          // sample light from air neighbor (clamped to grid)
          const lx = Math.max(0, Math.min(w - 1, ax))
          const ly = Math.max(0, Math.min(h - 1, ay))
          const lz = Math.max(0, Math.min(d - 1, az))
          const li = idx(lx, ly, lz)
          const lr = light[li * 3] / 255
          const lg = light[li * 3 + 1] / 255
          const lb = light[li * 3 + 2] / 255

          for (const [vx, vy, vz] of face.v) {
            positions.push((x + vx) * VoxelSize, (y + vy) * VoxelSize, (z + vz) * VoxelSize)
            normals.push(...face.n)
            lightRgbAttr.push(lr, lg, lb)
            texLayerAttr.push(texLayer)
          }

          // UVs per quad corner (same for all faces)
          uvs.push(0, 0, 0, 1, 1, 1, 1, 0)

          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3)
          vi += 4
        }
      }
    }
  }

  const mesh = new BABYLON.Mesh('clean-voxels', scene)

  const vd = new BABYLON.VertexData()
  vd.positions = new Float32Array(positions)
  vd.normals = new Float32Array(normals)
  vd.uvs = new Float32Array(uvs)
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(mesh)

  mesh.setVerticesData('texLayer', new Float32Array(texLayerAttr), false, 1)
  mesh.setVerticesData('lightRgb', new Float32Array(lightRgbAttr), false, 3)

  const mat = new BABYLON.ShaderMaterial('clean-voxel-mat', scene, {
    vertexSource: VERT,
    fragmentSource: FRAG,
  }, {
    attributes: ['position', 'normal', 'uv', 'texLayer', 'lightRgb'],
    uniforms: ['world', 'viewProjection'],
    samplers: ['tiles'],
  })

  mat.setTexture('tiles', texArray)
  mesh.material = mat

  return mesh
}

// ─── entry point ──────────────────────────────────────────────────────────────

export async function buildCleanMesh(
  field: NdArray<Uint16Array>,
  lanterns: LanternRecord[],
  scene: BABYLON.Scene,
): Promise<BABYLON.Mesh> {
  const field8 = to8bit(field)
  const light = floodfill(field8, lanterns as any)
  const texArray = await atlasToTextureArray('/textures/atlas-ao.png', scene)
  return buildMesh(field8, light, texArray, scene)
}
