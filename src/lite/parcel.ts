import type { Mesh, TransformNode } from '@babylonjs/lite'
import { defaultColors } from '../../common/content/blocks'
import { VoxelSize } from '../../common/voxels/constants'
import { getBufferFromVoxels, getFieldShape } from '../../common/voxels/helpers'
import { runCompute } from '../mono-pool'
import { voxelCollider } from '../../common/vox/collider'
import { addVoxels, removeCollider } from '../physics/world'
import { liteFeatures } from './features'
import type { Lite } from './index'
import { hex, loadTex } from './utils'

// an ndarray after structured clone: plain data, no methods
type Field = { data: Uint16Array; shape: [number, number, number]; stride: number[]; offset: number }

// lighting from the bake times palette. glass has no lighting buffer (white)
function tint(light: Float32Array | null, idx: Float32Array, pal: [number, number, number][], scale: number) {
  const out = new Float32Array(idx.length * 4)
  for (let i = 0; i < idx.length; i++) {
    const p = pal[idx[i] | 0] || pal[0]
    const o = i * 4
    out[o] = (light ? light[o] : 1) * p[0] * scale
    out[o + 1] = (light ? light[o + 1] : 1) * p[1] * scale
    out[o + 2] = (light ? light[o + 2] : 1) * p[2] * scale
    out[o + 3] = 1
  }
  return out
}

export class LiteParcel {
  root: TransformNode
  disposed = false
  private meshes: Mesh[] = []
  private key: string

  constructor(
    public lite: Lite,
    public record: any,
    private field?: Field,
  ) {
    const r = record
    this.key = 'parcel-' + r.id
    this.root = lite.L.createTransformNode('parcel/' + r.id, (r.x1 + r.x2) / 2, r.y1, (r.z1 + r.z2) / 2)
  }

  add(mesh: Mesh, parent: TransformNode = this.root) {
    if (this.disposed) return
    mesh.parent = parent
    this.meshes.push(mesh)
    this.lite.L.addToScene(this.lite.scene, mesh)
  }

  async generate() {
    const r = this.record
    const { L, engine } = this.lite
    const width = (r.x2 - r.x1) / VoxelSize
    const depth = (r.z2 - r.z1) / VoxelSize
    // same math as parcel.ts generateVoxelField / colliderOrigin
    const off: [number, number, number] = [-width / 4 + 0.25, -0.75 + (r.kind == 'inner' ? 0.0025 : 0), -depth / 4 + 0.25]
    const field = this.field ?? (getBufferFromVoxels({ ...r, fieldShape: getFieldShape(r) }) as any as Field | undefined)

    if (field) {
      const pal = (r.palette?.length ? r.palette : defaultColors).map((c: string, i: number) => hex(c || defaultColors[i]))
      const lanterns = (r.features ?? []).filter((f: any) => f?.type === 'lantern').map((l: any) => ({ position: l.position, color: l.color ?? '#ffffff', strength: l.strength }))
      const tex = loadTex(this.lite, r.tileset ? process.env.IMG_HOST + '/' + r.tileset.slice(1) : '/textures/atlas-ao.png')
      const { opaque, glass } = await runCompute((w) => w.bakeLightmap(field.data, field.shape, field.stride, field.offset, lanterns, off, pal))
      if (this.disposed) return

      const m = L.createMeshFromData(engine, 'voxels', opaque.positions, opaque.normals, opaque.indices, opaque.uvs, undefined, undefined, tint(opaque.colors, opaque.colorIndices, pal, 0.8))
      const mat = L.createStandardMaterial()
      mat.diffuseColor = [0.6, 0.6, 0.6]
      mat.specularColor = [0.3, 0.3, 0.3]
      mat.specularPower = 10
      mat.diffuseTexture = await tex
      m.material = mat
      m.position.set(off[0], off[1], off[2])
      this.add(m)

      if (glass) {
        const g = L.createMeshFromData(engine, 'glass', glass.positions, glass.normals, glass.indices, undefined, undefined, undefined, tint(null, glass.colorIndices, pal, 1))
        const gm = L.createStandardMaterial()
        gm.alpha = 0.5
        gm.disableLighting = true
        gm.emissiveColor = [1, 1, 1]
        g.material = gm
        g.position.set(off[0], off[1], off[2])
        this.add(g)
      }

      const t = this.root.position
      addVoxels(this.key, voxelCollider(field.shape, field.data), { x: t.x - width / 4 + 0.25, y: t.y - 0.25, z: t.z - depth / 4 + 0.25 })
    }

    liteFeatures(this)
  }

  dispose() {
    this.disposed = true
    // removing from its only scene is the gpu disposal in lite
    for (const m of this.meshes) this.lite.L.removeFromScene(this.lite.scene, m)
    this.meshes.length = 0
    removeCollider(this.key)
  }
}
