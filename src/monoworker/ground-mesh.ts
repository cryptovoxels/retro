// Greedy quads on exposed voxel faces. The same triangles go to Babylon and Rapier.
export function groundMesh(bytes: Uint8Array) {
  const head = new DataView(bytes.buffer, bytes.byteOffset)
  const x0 = head.getInt32(0, true),
    z0 = head.getInt32(4, true)
  const w = head.getInt32(8, true),
    d = head.getInt32(12, true)
  const field = bytes.subarray(16)
  const layers = field.length / (w * d)
  const legacy = layers === 1
  if (w <= 0 || d <= 0 || ![1, 8, 16].includes(layers)) throw new Error('invalid terrain dimensions')
  const shape = [w, layers, d]
  const stride = [1, w * d, w]
  const scale = legacy ? 1 : 0.5
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = []
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3,
      v = (axis + 2) % 3,
      width = shape[u],
      depth = shape[v]
    const mask = new Int16Array(width * depth)
    for (let layer = 0; layer <= shape[axis]; layer++) {
      for (let j = 0; j < depth; j++)
        for (let i = 0; i < width; i++) {
          const at = layer * stride[axis] + j * stride[v] + i * stride[u]
          const a = layer ? field[at - stride[axis]] : 255,
            b = layer < shape[axis] ? field[at] : 255
          mask[j * width + i] = a !== 255 && b === 255 ? a + 1 : b !== 255 && a === 255 ? -b - 1 : 0
        }
      for (let j = 0; j < depth; j++)
        for (let i = 0; i < width; i++) {
          const at = i + j * width,
            face = mask[at]
          if (!face) continue
          let right = i + 1,
            end = j + 1
          while (right < width && mask[j * width + right] === face) right++
          rows: while (end < depth) {
            for (let col = i; col < right; col++) if (mask[end * width + col] !== face) break rows
            end++
          }
          for (let row = j; row < end; row++) mask.fill(0, row * width + i, row * width + right)
          const vertex = positions.length / 3,
            point = [0, 0, 0],
            normal = [0, 0, 0]
          point[axis] = layer
          normal[axis] = Math.sign(face)
          for (const [a, b] of [
            [i, j],
            [right, j],
            [right, end],
            [i, end],
          ]) {
            point[u] = a
            point[v] = b
            positions.push(x0 + point[0] * scale, (legacy ? -0.26 : -1.26) + point[1] * scale, z0 + point[2] * scale)
            normals.push(...normal)
            uvs.push(Math.abs(face) - 1, 0)
          }
          if (face > 0) indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3)
          else indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2)
        }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) }
}
