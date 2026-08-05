import type { NdArray } from 'ndarray'
import type { LanternRecord } from '../common/messages/feature'
import { createGlassMaterial } from './materials/glass'
import { runCompute } from './mono-pool'
import type { Geo, GlassGeo } from './monoworker/lightmap'

const DEBUG_LIGHT_PROBES = false

let cachedTex: BABYLON.Texture | null = null
let cachedTexUrl = ''

function loadTex(url: string, scene: BABYLON.Scene): BABYLON.Texture {
  if (cachedTex && cachedTexUrl === url) return cachedTex
  cachedTex = new BABYLON.Texture(url, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE)
  cachedTexUrl = url
  return cachedTex
}

export function applyCleanPalette(mesh: BABYLON.Mesh, palette: BABYLON.Color3[]) {
  const colorIndex = mesh.getVerticesData('colorIndex')
  const baseColor = mesh.getVerticesData('baseColor')
  if (!colorIndex || !baseColor) return false

  const colors = new Float32Array(baseColor.length)
  for (let i = 0; i < colorIndex.length; i++) {
    const p = palette[colorIndex[i] | 0] || palette[0]
    if (!p) continue
    const o = i * 4
    colors[o] = baseColor[o] * p.r
    colors[o + 1] = baseColor[o + 1] * p.g
    colors[o + 2] = baseColor[o + 2] * p.b
    colors[o + 3] = 1
  }
  mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, colors)
  return true
}

function mesh(geo: Geo, tex: BABYLON.Texture, scene: BABYLON.Scene, id: number, palette: BABYLON.Color3[]): BABYLON.Mesh {
  const m = new BABYLON.Mesh(`voxelizer/opaque-${id}`, scene)
  const vd = new BABYLON.VertexData()
  vd.positions = geo.positions
  vd.normals = geo.normals
  vd.uvs = geo.uvs
  vd.colors = geo.colors
  vd.indices = geo.indices
  vd.applyToMesh(m)

  m.setVerticesData('colorIndex', geo.colorIndices, false, 1)
  m.setVerticesData('baseColor', geo.colors, false, 4)
  applyCleanPalette(m, palette)

  const mat = new BABYLON.StandardMaterial('clean-voxel-mat', scene)
  mat.diffuseTexture = tex
  mat.specularColor.set(0.1, 0.05, 0.0)
  mat.specularPower = 42
  m.material = mat
  return m
}

function glassMesh(geo: GlassGeo, scene: BABYLON.Scene, id: number): BABYLON.Mesh {
  const m = new BABYLON.Mesh(`voxelizer/glass-${id}`, scene)
  const vd = new BABYLON.VertexData()
  vd.positions = geo.positions
  vd.normals = geo.normals
  vd.indices = geo.indices
  vd.applyToMesh(m)
  m.material = createGlassMaterial(scene, {})
  return m
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
  const lights = lanterns.map((l: any) => ({ position: l.position, color: l.color ?? '#ffffff', strength: l.strength }))
  const { opaque, glass } = await runCompute((w) => w.bakeLightmap(field.data, field.shape as [number, number, number], field.stride, field.offset, lights, off))
  const url = DEBUG_LIGHT_PROBES ? '/textures/00-grid.png' : '/textures/atlas-ao.png'
  const tex = texOverride ?? loadTex(url, scene)
  return { opaque: mesh(opaque, tex, scene, id, palette), glass: glass ? glassMesh(glass, scene, id) : null }
}
