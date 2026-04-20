import * as createAOMesh from 'ao-mesher'
import fill from '../voxels/ndarray-fill'
import ndarray from 'ndarray'
import { VertexData } from 'babylonjs'
const VoxReader = require('@sh-dave/format-vox').VoxReader

function parseVox(buffer: ArrayBuffer): Promise<any> {
  // Old-add vox reader code

  return new Promise((resolve, reject) => {
    VoxReader.read(buffer, (vox: any, errstr: string | null) => {
      if (!vox.models[0]) {
        reject('Unable to load a model')
      } else {
        resolve(vox)
      }
    })
  })
}

export default async function voxImport(url: string, scene: BABYLON.Scene): Promise<BABYLON.Mesh> {
  const f = await fetch(url)
  const b = await f.arrayBuffer()
  const vox = await parseVox(b)
  // console.log(vox)

  const Y = vox.sizes[0].y

  let size: { x: number; y: number; z: number } = { ...vox.sizes[0] }
  size.x += 4
  size.y += 4
  size.z += 4

  const field = ndarray(new Uint16Array(size.x * size.y * size.z), [size.x, size.z, size.y])

  const model = vox.models[0]
  for (let row of model) {
    const { x, y, z, colorIndex } = row
    field.set(x + 1, z + 1, Y - y, colorIndex + (1 << 15)) // 1 << 15 is OPAQUE_BIT
  }

  const palette = vox.palette
  let vertData: Uint8Array = createAOMesh(field)
  // console.log(vertData)

  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  let idx = 0

  for (let i = 0; i < vertData.length; i += 8 * 3) {
    const texId = vertData[i + 7]
    let { r, g, b } = palette[texId]
    r /= 256
    g /= 256
    b /= 256

    positions.push(vertData[i + 0], vertData[i + 1], vertData[i + 2])
    colors.push(r, g, b, 1)

    positions.push(vertData[i + 8], vertData[i + 9], vertData[i + 10])
    colors.push(r, g, b, 1)

    positions.push(vertData[i + 16], vertData[i + 17], vertData[i + 18])
    colors.push(r, g, b, 1)

    indices.push(idx, idx + 2, idx + 1)

    idx += 3
  }

  BABYLON.VertexData.ComputeNormals(positions, indices, normals)

  const vd = new BABYLON.VertexData()
  vd.positions = positions
  vd.colors = colors
  vd.normals = normals
  vd.indices = indices

  const mesh = new BABYLON.Mesh('fresh/import', scene)
  vd.applyToMesh(mesh)

  // Center mesh
  mesh.position.set(-size.x / 2 + 2, 0, -size.z / 2 + 1)
  mesh.bakeCurrentTransformIntoVertices()

  // Scale mesh
  mesh.scaling.set(0.02, 0.02, 0.02)
  mesh.bakeCurrentTransformIntoVertices()

  return mesh
}
