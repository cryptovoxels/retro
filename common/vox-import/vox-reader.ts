import ndarray from 'ndarray'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const createAOMesh = require('ao-mesher')

const intensity = 0.5
const offset = 0.4

export type VoxData = {
  positions: Int8Array
  indices: Uint16Array | Uint32Array
  colors: Uint8Array
  size: number[]
}

interface Callback {
  (x: VoxData | Error): void
}

function roundToNextHighestPowerOf2(v: number) {
  v--
  v |= v >> 1
  v |= v >> 2
  v |= v >> 4
  v |= v >> 8
  v |= v >> 16
  v |= v >> 32
  return v + 1
}

function hash(x: number) {
  x = (x ^ 12345391) * 2654435769
  x ^= (x << 6) ^ (x >> 26)
  x *= 2654435769
  x += (x << 5) ^ (x >> 12)
  return x
}

function hashTableLookUp(bucketData: Uint32Array, wrapMask: number, key_a: number, key_b: number) {
  const unwrappedHash = hash(key_a) ^ hash(key_b)
  let bucket_i = unwrappedHash & wrapMask

  while (1) {
    let i = bucket_i * 3
    if (bucketData[i] == key_a && bucketData[i + 1] == key_b) {
      return bucketData[i + 2]
    } else if (bucketData[i] == 0) {
      return bucket_i | 0x80000000
    }
    bucket_i = (bucket_i + 1) & wrapMask
  }
}

function clampI8(n: number) {
  return n < -127 ? -127 : n > 127 ? 127 : n | 0
}

export const voxReader = (buffer: ArrayBuffer, megavox: boolean, callback: Callback, colorMap?: Record<number, [number, number, number]>) => {
  VoxReader.read(buffer, (vox: any, errstr: string | null) => {
    if (errstr) {
      return callback(new Error('VoxReader error: ' + errstr))
    }

    if (vox.models.length > 1) {
      return callback(new Error('Multiple models not supported yet'))
    }

    let size: { x: number; y: number; z: number } = { ...vox.sizes[0] }
    const originalSize = { ...size }

    const limit = megavox ? 128 + 128 + 128 : 32 + 32 + 32
    if (size.x + size.y + size.z > limit) {
      return callback(new Error('Larger .vox not supported yet'))
    }

    // Oversize because ao-mesher doesn't create faces on the boundaries
    size.x += 4
    size.y += 4
    size.z += 4

    const field = ndarray(new Uint16Array(size.x * size.y * size.z), [size.x, size.y, size.z])

    const model = vox.models[0]
    const palette = vox.palette
    model.forEach((row: any) => {
      const { x, y, z, colorIndex } = row
      field.set(x + 1, y + 1, z + 1, colorIndex + (1 << 15))
    })

    const vertData: Uint8Array = createAOMesh(field)

    const numUnmergedVerts = vertData.length / 8
    const positions = new Int8Array(numUnmergedVerts * 3)
    const indices = new Uint32Array(numUnmergedVerts)
    const colors = new Uint8Array(numUnmergedVerts * 4)

    const colorTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      colorTable[i] = palette[i].r | (palette[i].g << 8) | (palette[i].b << 16)
    }
    if (colorMap) {
      for (const [idx, rgb] of Object.entries(colorMap)) {
        colorTable[+idx] = rgb[0] | (rgb[1] << 8) | (rgb[2] << 16)
      }
    }

    const halfX = originalSize.x >> 1
    const halfY = originalSize.y >> 1

    const numBuckets = roundToNextHighestPowerOf2(Math.ceil(Math.max(numUnmergedVerts, 2) * 1.5))
    const wrapMask = numBuckets - 1
    const bucketData = new Uint32Array(numBuckets * 3)

    let i = 0
    let next_v_i = 0
    let index_i = 0

    while (i < vertData.length) {
      const textureIndex = vertData[i + 7]
      const packedRgb = colorTable[textureIndex]
      const r = packedRgb & 0xff
      const g = (packedRgb >> 8) & 0xff
      const b = (packedRgb >> 16) & 0xff

      for (let j = 0; j < 3; j++) {
        const ax = vertData[i]
        const ay = vertData[i + 1]
        const az = vertData[i + 2]
        const ao = vertData[i + 3]

        // key uses Babylon-mapped axes (same as old x,y=aoZ,z=aoY packing)
        const x = ax
        const y = az
        const z = ay

        const key_a = x | (y << 8) | (z << 16) | (1 << 24)
        const key_b = packedRgb | ((ao & 240) << 20)

        const result = hashTableLookUp(bucketData, wrapMask, key_a, key_b)
        let v_i = 0
        if ((result! & 0x80000000) == 0) {
          v_i = result!
        } else {
          v_i = next_v_i++
          const bucket_i = result! & 0x7fffffff
          bucketData[bucket_i * 3] = key_a
          bucketData[bucket_i * 3 + 1] = key_b
          bucketData[bucket_i * 3 + 2] = v_i

          // Mirrored X, Y=aoZ, Z=-aoY (voxel units; *0.02 via mesh setPreTransformMatrix)
          const posOffset = v_i * 3
          positions[posOffset] = clampI8(size.x - ax - halfX)
          positions[posOffset + 1] = clampI8(az)
          positions[posOffset + 2] = clampI8(-(ay - halfY))

          // Bake AO into RGB bytes (normalized upload /255 matches old float look)
          const shade = ao * (1.0 / 255) * intensity + offset
          const colOffset = v_i * 4
          colors[colOffset] = (r * shade) | 0
          colors[colOffset + 1] = (g * shade) | 0
          colors[colOffset + 2] = (b * shade) | 0
          colors[colOffset + 3] = 255
        }
        indices[index_i++] = v_i
        i += 8
      }
    }

    const numMergedVerts = next_v_i
    const finalIndices = numMergedVerts < 65536 ? Uint16Array.from(indices.subarray(0, index_i)) : indices.subarray(0, index_i)

    callback({
      positions: positions.subarray(0, numMergedVerts * 3),
      indices: finalIndices,
      colors: colors.subarray(0, numMergedVerts * 4),
      size: [originalSize.x, originalSize.y, originalSize.z],
    })
  })
}
