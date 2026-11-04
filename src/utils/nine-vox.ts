import { voxImporter, VOX_SCALE } from '../../common/vox-import/vox-import'
import type Feature from '../features/feature'
import { featureLOD, freezeFeature } from '../utils'

// 9-slice for vox models: the border thickness is the corner size, the rest stretches.
// load once per url, stamp as many stretched copies as you like
type Slab = { positions: Float32Array; colors: Uint8Array; indices: Uint16Array | Uint32Array; min: number[]; size: number[]; border: number[]; geometries: WeakMap<BABYLON.Scene, Map<string, BABYLON.Geometry>> }

const slabs = new Map<string, Promise<Slab | null>>()
let material: BABYLON.StandardMaterial | null = null

export function loadNineVox(url: string): Promise<Slab | null> {
  let p = slabs.get(url)
  if (!p) {
    p = voxImporter()
      .import(url, { signal: new AbortController().signal })
      .then((mesh) => {
        // Stretch positions as floats; keep the normalized color bytes packed.
        const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind) as Float32Array | null
        const colors = mesh.getVertexBuffer(BABYLON.VertexBuffer.ColorKind)?.getData() as Uint8Array | null
        const indices = mesh.getIndices() as Uint16Array | Uint32Array | null
        mesh.material?.dispose()
        mesh.dispose()
        if (!positions || !colors || !indices) return null

        // real bounds in vox units, the model is not centred on origin
        const min = [Infinity, Infinity, Infinity]
        const max = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < positions.length; i++) {
          const a = i % 3
          if (positions[i] < min[a]) min[a] = positions[i]
          if (positions[i] > max[a]) max[a] = positions[i]
        }
        const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

        // border = how far the left bar reaches in at the centre row (and the bottom bar at the centre column)
        const border = [0, 0]
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i] - min[0]
          const y = positions[i + 1] - min[1]
          if (Math.abs(y - size[1] / 2) <= 1 && x < size[0] / 2 && x > border[0]) border[0] = x
          if (Math.abs(x - size[0] / 2) <= 1 && y < size[1] / 2 && y > border[1]) border[1] = y
        }
        if (!border[0]) border[0] = size[0] / 3
        if (!border[1]) border[1] = size[1] / 3
        return { positions, colors, indices, min, size, border, geometries: new WeakMap() }
      })
      .catch(() => null)
    slabs.set(url, p)
  }
  return p
}

// The feature dimensions are the hole in metres; z is the frame depth.
export function nineVox(slab: Slab, feature: Feature): BABYLON.Mesh {
  const { scene } = feature
  const { x: w, y: h } = feature.scale
  let geometries = slab.geometries.get(scene)
  if (!geometries) slab.geometries.set(scene, (geometries = new Map()))
  const key = `${w}:${h}`
  const mesh = new BABYLON.Mesh('utils/nine-vox', scene)
  const geometry = geometries.get(key)
  if (geometry && !geometry.isDisposed()) {
    geometry.applyToMesh(mesh)
  } else {
    const { positions, min, size, border } = slab
    const [bx, by] = border
    const midX = size[0] - 2 * bx
    const midY = size[1] - 2 * by
    // grow the middle until the hole is w x h
    const dx = Math.max(0, w / VOX_SCALE - midX)
    const dy = Math.max(0, h / VOX_SCALE - midY)
    const cx = (size[0] + dx) / 2
    const cy = (size[1] + dy) / 2
    const cz = size[2] / 2

    const out = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] - min[0]
      const y = positions[i + 1] - min[1]
      // turned 180 about y so the lip faces the viewer (flipping z alone would mirror the winding)
      out[i] = cx - (x + (x <= bx ? 0 : x >= bx + midX ? dx : ((x - bx) / midX) * dx))
      out[i + 1] = y + (y <= by ? 0 : y >= by + midY ? dy : ((y - by) / midY) * dy) - cy
      out[i + 2] = cz - (positions[i + 2] - min[2])
    }

    mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, out, false)
    mesh.setVerticesBuffer(new BABYLON.VertexBuffer(scene.getEngine(), slab.colors, BABYLON.VertexBuffer.ColorKind, { size: 4, type: BABYLON.VertexBuffer.UNSIGNED_BYTE, normalized: true }))
    mesh.setIndices(slab.indices)
    geometries.set(key, mesh.geometry!)
  }
  const shared = mesh.geometry!
  mesh.onDisposeObservable.addOnce(() => {
    if (!shared.meshes.length) geometries.delete(key)
  })

  if (!material || material.getScene() !== scene) {
    material = new BABYLON.StandardMaterial('utils/nine-vox', scene)
    material.specularColor.set(0, 0, 0)
    material.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE
    material.freeze()
  }

  mesh.setPreTransformMatrix(BABYLON.Matrix.Scaling(VOX_SCALE, VOX_SCALE, VOX_SCALE))
  mesh.useVertexColors = true
  mesh.isPickable = false
  mesh.material = material
  mesh.parent = feature.mesh!
  mesh.scaling.set(1 / feature.mesh!.scaling.x, 1 / feature.mesh!.scaling.y, 1 / feature.mesh!.scaling.z)
  ;(mesh as any).feature = feature
  featureLOD(feature)
  freezeFeature(feature)
  return mesh
}
