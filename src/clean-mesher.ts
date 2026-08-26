import type { NdArray } from 'ndarray'
import type { LanternRecord } from '../common/messages/feature'
import { createGlassMaterial } from './materials/glass'
import { stubMaterial, stubMesh, stubVertexData } from './utils/stub-mesh'
import { runCompute } from './mono-pool'
import type { Geo, GlassGeo } from './monoworker/lightmap'
import { Color3, Mesh, SceneContext, Texture2D } from '@babylonjs/lite'

const DEBUG_LIGHT_PROBES = false

let cachedTex: Texture2D | null = null
let cachedTexUrl = ''

function loadTex(url: string, _scene: SceneContext): Texture2D {
  if (cachedTex && cachedTexUrl === url) return cachedTex
  cachedTex = {} as Texture2D
  cachedTexUrl = url
  return cachedTex
}

function tintVertexColors(lighting: Float32Array, colorIndices: Float32Array, palette: Color3[]) {
  const colors = new Float32Array(lighting.length)
  for (let i = 0; i < colorIndices.length; i++) {
    const p = palette[colorIndices[i] | 0] || palette[0]
    if (!p) continue
    const o = i * 4
    colors[o] = lighting[o] * p.r
    colors[o + 1] = lighting[o + 1] * p.g
    colors[o + 2] = lighting[o + 2] * p.b
    colors[o + 3] = 1
  }
  return colors
}

export function applyCleanPalette(mesh: Mesh, palette: Color3[]) {
  const colorIndex = mesh.getVerticesData('colorIndex')
  const baseColor = mesh.getVerticesData('baseColor')
  if (!colorIndex || !baseColor) return false

  mesh.updateVerticesData('color', tintVertexColors(baseColor as Float32Array, colorIndex as Float32Array, palette))
  return true
}

function mesh(geo: Geo, tex: Texture2D, _scene: SceneContext, id: number, palette: Color3[]): Mesh {
  const m = stubMesh(`voxelizer/opaque-${id}`)
  const vd = stubVertexData()
  vd.positions = geo.positions
  vd.normals = geo.normals
  vd.uvs = geo.uvs
  vd.colors = tintVertexColors(geo.colors, geo.colorIndices, palette)
  vd.indices = geo.indices
  vd.applyToMesh(m)

  // lighting-only base + tint index for live palette drag
  m.setVerticesData('colorIndex', geo.colorIndices, false, 1)
  m.setVerticesData('baseColor', geo.colors, false, 4)

  const mat = stubMaterial()
  mat.diffuseTexture = tex

  const c = 0.6
  mat.diffuseColor.set(c, c, c)

  mat.specularColor.set(0.3, 0.3, 0.3)
  mat.specularPower = 10
  m.material = mat
  m.useVertexColors = true
  return m
}

function glassMesh(geo: GlassGeo, scene: SceneContext, id: number, palette: Color3[]): Mesh {
  const m = stubMesh(`voxelizer/glass-${id}`)
  const vd = stubVertexData()
  vd.positions = geo.positions
  vd.normals = geo.normals
  vd.indices = geo.indices
  const base = new Float32Array(geo.colorIndices.length * 4)
  for (let i = 0; i < geo.colorIndices.length; i++) {
    const o = i * 4
    base[o] = 1
    base[o + 1] = 1
    base[o + 2] = 1
    base[o + 3] = 1
  }
  vd.colors = tintVertexColors(base, geo.colorIndices, palette)
  vd.applyToMesh(m)
  m.setVerticesData('colorIndex', geo.colorIndices, false, 1)
  m.setVerticesData('baseColor', base, false, 4)
  // white material - vertex colors carry palette tint
  m.material = createGlassMaterial(scene, { tint: [1, 1, 1] })
  m.useVertexColors = true
  return m
}

// ─── entry point ──────────────────────────────────────────────────────────────

export async function buildCleanMesh(
  field: NdArray<Uint16Array>,
  lanterns: LanternRecord[],
  scene: SceneContext,
  off: [number, number, number],
  id: number,
  palette: Color3[],
  texOverride?: Texture2D,
): Promise<{ opaque: Mesh; glass: Mesh | null }> {
  const lights = lanterns.map((l: any) => ({ position: l.position, color: l.color ?? '#ffffff', strength: l.strength }))
  const pal = palette.map((c) => [c.r, c.g, c.b] as [number, number, number])
  const { opaque, glass } = await runCompute((w) => w.bakeLightmap(field.data, field.shape as [number, number, number], field.stride, field.offset, lights, off, pal))
  const url = DEBUG_LIGHT_PROBES ? '/textures/00-grid.png' : '/textures/atlas-ao.png'
  const tex = texOverride ?? loadTex(url, scene)
  return { opaque: mesh(opaque, tex, scene, id, palette), glass: glass ? glassMesh(glass, scene, id, palette) : null }
}
