import * as createAOMesh from 'ao-mesher'
import ndarray from 'ndarray'
import { oversizedField } from './helpers'
import { setVoxelData } from './mesher'
import fill from './ndarray-fill'

/** Fill an ndarray via callback, ao-mesh it, return a unit-cube-sized mesh. */
export function voxFromFill(size: [number, number, number], fillFn: (x: number, y: number, z: number, w: number, h: number, d: number) => number, scene: BABYLON.Scene): BABYLON.Mesh {
  const [w, h, d] = size
  const field = ndarray(new Uint16Array(w * h * d), [w, h, d])
  fill(field, (x, y, z) => {
    const v = fillFn(x, y, z, w, h, d)
    return v ? v | (1 << 15) : 0
  })

  const oversized = oversizedField(field)
  const vertData: Uint8Array | null = createAOMesh(oversized)

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let indexCount = 0

  // same remap as vox-reader: ao * 0.5 + 0.4 so corners darken without crushing to black
  const aoColor = (ao: number) => ao * (1 / 255) * 0.5 + 0.4

  if (vertData) {
    for (let i = 0; i < vertData.length; i += 8 * 3) {
      indexCount += setVoxelData(vertData, i, positions, normals, indices, indexCount)
      const a = aoColor(vertData[i + 3])
      const b = aoColor(vertData[i + 11])
      const c = aoColor(vertData[i + 19])
      colors.push(a, a, a, 1, b, b, b, 1, c, c, c, 1)
    }
  }

  // Center and scale to unit cube
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
