import type { NdArray } from 'ndarray'
import type { LanternRecord } from '../common/messages/feature'
import { createGlassMaterial } from './materials/glass'
import { stubMesh } from './utils/stub-mesh'
import { runCompute } from './mono-pool'
import type { Geo, GlassGeo } from './monoworker/lightmap'
import {
  Color3,
  Mesh,
  SceneContext,
  Texture2D,
  addToScene,
  createMeshFromData,
  createStandardMaterial,
  loadTexture2D,
} from '@babylonjs/lite'

const DEBUG_LIGHT_PROBES = false

let cachedTex: Texture2D | null = null
let cachedTexUrl = ''

async function loadTex(url: string, scene: SceneContext): Promise<Texture2D> {
  if (cachedTex && cachedTexUrl === url) return cachedTex
  cachedTex = await loadTexture2D(scene.surface.engine, url)
  cachedTexUrl = url
  return cachedTex
}

function tintVertexColors(lighting: Float32Array, colorIndices: Float32Array, palette: Color3[]) {
  const colors = new Float32Array(lighting.length)
  for (let i = 0; i < colorIndices.length; i++) {
    const p = palette[colorIndices[i] | 0] || palette[0]
    if (!p) continue
    const o = i * 4
    colors[o] = lighting[o] * p[0]
    colors[o + 1] = lighting[o + 1] * p[1]
    colors[o + 2] = lighting[o + 2] * p[2]
    colors[o + 3] = 1
  }
  return colors
}

export function applyCleanPalette(mesh: Mesh, palette: Color3[]) {
  const colorIndex = (mesh as any).getVerticesData?.('colorIndex')
  const baseColor = (mesh as any).getVerticesData?.('baseColor')
  if (!colorIndex || !baseColor) return false
  ;(mesh as any).updateVerticesData?.('color', tintVertexColors(baseColor as Float32Array, colorIndex as Float32Array, palette))
  return true
}

function meshPos(mesh: Mesh, x: number, y: number, z: number) {
  const p = mesh.position as any
  if (p.set) p.set(x, y, z)
  else {
    p[0] = x
    p[1] = y
    p[2] = z
  }
}

function mesh(geo: Geo, tex: Texture2D, scene: SceneContext, id: number, palette: Color3[]): Mesh {
  const engine = scene.surface.engine
  const colors = tintVertexColors(geo.colors, geo.colorIndices, palette)
  const m = createMeshFromData(engine, `voxelizer/opaque-${id}`, geo.positions, geo.normals, geo.indices, geo.uvs, undefined, undefined, colors)

  const mat = createStandardMaterial()
  mat.diffuseTexture = tex
  mat.diffuseColor = [0.6, 0.6, 0.6]
  mat.specularColor = [0.3, 0.3, 0.3]
  mat.specularPower = 10
  m.material = mat
  ;(m as any).colorIndex = geo.colorIndices
  ;(m as any).baseColor = geo.colors
  addToScene(scene, m)
  return m
}

function glassMesh(geo: GlassGeo, scene: SceneContext, id: number, palette: Color3[]): Mesh {
  // todo(lite): glass voxels via createMeshFromData + transmissive mat
  const m = stubMesh(`voxelizer/glass-${id}`)
  const base = new Float32Array(geo.colorIndices.length * 4)
  for (let i = 0; i < geo.colorIndices.length; i++) {
    const o = i * 4
    base[o] = 1
    base[o + 1] = 1
    base[o + 2] = 1
    base[o + 3] = 1
  }
  m.material = createGlassMaterial(scene, { tint: [1, 1, 1] }) as any
  return m
}

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
  const pal = palette.map((c) => [c[0], c[1], c[2]] as [number, number, number])
  const { opaque, glass } = await runCompute((w) => w.bakeLightmap(field.data, field.shape as [number, number, number], field.stride, field.offset, lights, off, pal))
  const url = DEBUG_LIGHT_PROBES ? '/textures/00-grid.png' : '/textures/atlas-ao.png'
  const tex = texOverride ?? (await loadTex(url, scene))
  const built = mesh(opaque, tex, scene, id, palette)
  meshPos(built, off[0], off[1], off[2])
  return { opaque: built, glass: glass ? glassMesh(glass, scene, id, palette) : null }
}
