export type Vec3 = { x: number; y: number; z: number }

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function aabbDistance(p: Vec3, min: Vec3, max: Vec3): number {
  const x = Math.max(min.x, Math.min(max.x, p.x))
  const y = Math.max(min.y, Math.min(max.y, p.y))
  const z = Math.max(min.z, Math.min(max.z, p.z))
  const dx = p.x - x
  const dy = p.y - y
  const dz = p.z - z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function computeNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0)

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3
    const i1 = indices[i + 1] * 3
    const i2 = indices[i + 2] * 3

    const ax = positions[i1] - positions[i0]
    const ay = positions[i1 + 1] - positions[i0 + 1]
    const az = positions[i1 + 2] - positions[i0 + 2]
    const bx = positions[i2] - positions[i0]
    const by = positions[i2 + 1] - positions[i0 + 1]
    const bz = positions[i2 + 2] - positions[i0 + 2]

    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx

    normals[i0] += nx
    normals[i0 + 1] += ny
    normals[i0 + 2] += nz
    normals[i1] += nx
    normals[i1 + 1] += ny
    normals[i1 + 2] += nz
    normals[i2] += nx
    normals[i2 + 1] += ny
    normals[i2 + 2] += nz
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2]) || 1
    normals[i] /= len
    normals[i + 1] /= len
    normals[i + 2] /= len
  }

  return normals
}

function transformPoint(positions: number[], i: number, m: Float32Array) {
  const x = positions[i]
  const y = positions[i + 1]
  const z = positions[i + 2]
  positions[i] = m[0] * x + m[4] * y + m[8] * z + m[12]
  positions[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  positions[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[r + c * 4] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3]
    }
  }
  return out
}

function rotX(a: number): Float32Array {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
}

function rotY(a: number): Float32Array {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
}

function scale(sx: number, sy: number, sz: number): Float32Array {
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1])
}

function translate(tx: number, ty: number, tz: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1])
}

function bounds(positions: number[]) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2])
    maxX = Math.max(maxX, positions[i])
    maxY = Math.max(maxY, positions[i + 1])
    maxZ = Math.max(maxZ, positions[i + 2])
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

export function bakePolytextTransform(positions: number[]) {
  let m = multiply(rotX(-Math.PI / 2), rotY(-Math.PI / 2))
  const b = bounds(positions)
  const width = b.maxX - b.minX
  const depth = b.maxZ - b.minZ
  m = multiply(m, scale(4, 1, 8))
  m = multiply(m, translate(depth / 2, 0, (-width * 4) / 2))

  for (let i = 0; i < positions.length; i += 3) {
    transformPoint(positions, i, m)
  }
}
