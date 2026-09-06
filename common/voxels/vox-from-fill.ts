import ndarray from 'ndarray'
import fill from './ndarray-fill'
import { meshLegacyField } from '../../src/monoworker/mesh'

/** Fill an ndarray via callback, mesh it, return a unit-cube-sized mesh. */
export function voxFromFill(size: [number, number, number], fillFn: (x: number, y: number, z: number, w: number, h: number, d: number) => number, scene: BABYLON.Scene): BABYLON.Mesh {
  const [w, h, d] = size
  const field = ndarray(new Uint16Array(w * h * d), [w, h, d])
  fill(field, (x, y, z) => {
    const v = fillFn(x, y, z, w, h, d)
    return v ? v | (1 << 15) : 0
  })

  const out = meshLegacyField(field.data, [w, h, d], field.stride, field.offset)
  const geo = out.opaque
  const positions = Array.from(geo.positions)
  const normals = Array.from(geo.normals)
  const colors = Array.from(geo.colors)
  const indices = Array.from(geo.indices)

  if (positions.length) {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i])
      maxX = Math.max(maxX, positions[i])
      minY = Math.min(minY, positions[i + 1])
      maxY = Math.max(maxY, positions[i + 1])
      minZ = Math.min(minZ, positions[i + 2])
      maxZ = Math.max(maxZ, positions[i + 2])
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    const s = 1 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6)
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (positions[i] - cx) * s
      positions[i + 1] = (positions[i + 1] - cy) * s
      positions[i + 2] = (positions[i + 2] - cz) * s
    }
  }

  const vd = new BABYLON.VertexData()
  vd.positions = positions
  vd.normals = normals
  vd.colors = colors
  vd.indices = indices

  const mesh = new BABYLON.Mesh('vox-from-fill', scene)
  vd.applyToMesh(mesh)
  return mesh
}
