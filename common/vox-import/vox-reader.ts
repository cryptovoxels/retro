import ndarray from 'ndarray'

const VoxReader = require('@sh-dave/format-vox').VoxReader
const createAOMesh = require('ao-mesher')

const intensity = 0.5
const offset = 0.4

type VoxDataWithoutCollider = {
  positions: Float32Array
  indices: Uint16Array | Uint32Array
  colors: Float32Array
  size: number[]
}
type VoxDataColliderInfo = {
  colliderPositions: number[]
  colliderIndices: number[]
}
type VoxDataWithCollider = VoxDataWithoutCollider & VoxDataColliderInfo

export type VoxData = VoxDataWithCollider | VoxDataWithoutCollider

export class TriangleLimitExceededError extends Error {
  constructor(nTriangles: number, maxTriangles: number) {
    super(`${nTriangles} triangles in vox model mesh exceeds limit of ${maxTriangles}`)
    this.name = 'TriangleLimitExceededError'
  }
}

interface Callback {
  (x: VoxData | Error): void
}

interface Color {
  r: number
  g: number
  b: number
}

const hexComponent = (i: number): string => {
  const str = i.toString(16)
  return i <= 15 ? ('0' + str).toUpperCase() : str.toUpperCase()
}

function toHexString(clr: Color): string {
  return '#' + hexComponent(clr.r) + hexComponent(clr.g) + hexComponent(clr.b)
}

// Adapted from http://graphics.stanford.edu/~seander/bithacks.html#RoundUpPowerOf2
// Not correct for 0 input: returns 0 in this case.
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

// Hash from UInt32 -> UInt32
function hash(x: number) {
  x = (x ^ 12345391) * 2654435769
  x ^= (x << 6) ^ (x >> 26)
  x *= 2654435769
  x += (x << 5) ^ (x >> 12)
  return x
}

// Looks up a value (vertex index = v_i) for a given key in the map.
// If an entry corresponding to (key_a, key_b) is found, then returns the corresponding value v_i.
// If an entry corresponding to (key_a, key_b) is not found, then returns bucket_i | 0x80000000, where bucket_i is the index
// of the bucket where the value should be inserted.  We set the leftmost bit to indicate that we did not find the value for the key.
function hashTableLookUp(bucketData: Uint32Array, wrapMask: number, key_a: number, key_b: number) {
  const unwrappedHash = hash(key_a) ^ hash(key_b)
  let bucket_i = unwrappedHash & wrapMask
  //console.assert(bucket_i >= 0 && bucket_i * 3 < bucketData.length)

  // Linear probe - hash key then do linear search for key or empty bucket.
  while (1) {
    // We know this loop will terminate because the load factor should be less than 1, since the number of buckets is > max num verts inserted.
    let i = bucket_i * 3
    //console.assert(i >= 0 && i < bucketData.length)
    if (bucketData[i] == key_a && bucketData[i + 1] == key_b) {
      // If the key is stored in this bucket:
      // We have found our key in the hash table
      return bucketData[i + 2] // Return v_i
    } else if (bucketData[i] == 0) {
      // This hash table bucket is empty.  Therefore the key is not in the table.
      return bucket_i | 0x80000000
    }

    bucket_i = (bucket_i + 1) & wrapMask
  }
}

export const voxReader = (buffer: ArrayBuffer, renderJob: any, flipX: boolean, megavox: boolean, maxTriangles: number, dryRun: boolean, wantCollider: boolean, callback: Callback) => {
  // console.log('voxReader processing...')

  VoxReader.read(buffer, (vox: any, errstr: string | null) => {
    // let startTime = performance.now()
    if (errstr) {
      const err = new Error('VoxReader error: ' + errstr)
      return callback(err)
    }

    // console.log('vox-reader.ts: VoxReader.read() took ' + (performance.now() - startTime) + ' ms.')

    if (vox.models.length > 1) {
      const err = new Error('Multiple models not supported yet')
      return callback(err)
    }

    let size: { x: number; y: number; z: number } = { ...vox.sizes[0] }
    const originalSize = { ...size }

    const limit = megavox ? 128 + 128 + 128 : 32 + 32 + 32
    if (size.x + size.y + size.z > limit) {
      const err = new Error('Larger .vox not supported yet')
      return callback(err)
    }

    // Oversize because ao-mesher doesn't create faces on the boundaries
    size.x += 4
    size.y += 4
    size.z += 4

    const field = ndarray(new Uint16Array(size.x * size.y * size.z), [size.x, size.y, size.z])

    let model = vox.models[0]
    const palette = vox.palette
    model.forEach((row: any) => {
      const { x, y, z, colorIndex } = row
      field.set(x + 1, y + 1, z + 1, colorIndex + (1 << 15)) // 1 << 15 is OPAQUE_BIT
    })

    // startTime = performance.now()
    let vertData: Uint8Array = createAOMesh(field)

    if (vertData.length > maxTriangles * 3 * 8) {
      const err = new TriangleLimitExceededError(vertData.length / 3 / 8, maxTriangles)
      return callback(err)
    }

    if (dryRun) {
      // Caller just wanted to check we meet the triangle threshold
      return callback({
        positions: new Float32Array(),
        indices: new Uint16Array(),
        colors: new Float32Array(),
        size: [0, 0, 0],
        ...(wantCollider
          ? {
              colliderPositions: [],
              colliderIndices: [],
            }
          : {}),
      })
    }

    // console.log('vox-reader.ts: createAOMesh() took ' + (performance.now() - startTime) + ' ms.')

    // Allocate arrays using the number of unmerged vertices - this gives an upper bound on the final array sizes.
    const numUnmergedVerts = vertData.length / 8 // createAOMesh returns 8 values per vert.
    const positions = new Float32Array(numUnmergedVerts * 3) // 3 components per vert
    const indices = new Uint32Array(numUnmergedVerts) // 1 index per vert
    const colors = new Float32Array(numUnmergedVerts * 4) // 4 components per vert

    // Create colour table
    const colorTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      colorTable[i] = palette[i].r | (palette[i].g << 8) | (palette[i].b << 16)
    }

    // Identity function, use these to nudge the mesh as needed
    let gran = (n: number) => Math.round(n * 1000) / 1000
    let fx = (x: number) => gran(0.02 * (x - originalSize.x / 2))
    let fy = (y: number) => gran(0.02 * (y - originalSize.y / 2))
    let fz = (z: number) => gran(0.02 * z)
    if (flipX) {
      fx = fx = (x) => gran(0.02 * (size.x - x - originalSize.x / 2))
    }

    const numBuckets = roundToNextHighestPowerOf2(Math.ceil(Math.max(numUnmergedVerts, 2) * 1.5)) // Capacity factor of at least 1.5.  (We know the final number of verts will be <= numUnmergedVerts)
    //console.assert(numBuckets > numUnmergedVerts);
    // Max with 2 to handle case where numUnmergedVerts = 0.
    const wrapMask = numBuckets - 1 // This gives us a number with bit set such that ANDing with it will be equal to the number mod numbuckets, e.g. x & wrapMask == x % numBuckets
    const bucketData = new Uint32Array(numBuckets * 3) // Each bucket will be laid out as [key_a, key_b, v_i].  key_a == 0 denotes an empty bucket.

    const textureIndexUsed = new Uint32Array(256)
    let i = 0
    let next_v_i = 0
    let index_i = 0

    while (i < vertData.length) {
      const textureIndex = vertData[i + 7] // Note that this should be the same for all verts sharing a face
      textureIndexUsed[textureIndex] = 1
      const packedRgb = colorTable[textureIndex] // = color.r | (color.g << 8) | (color.b << 16)
      const r = packedRgb & 0xff
      const g = (packedRgb >> 8) & 0xff
      const b = (packedRgb >> 16) & 0xff

      for (let j = 0; j < 3; j++) {
        // be aware of the coordinate flip, converting coordinate system for y and z
        const x = vertData[i] // all values are uint8s so should be in the range of 0-255
        const y = vertData[i + 2]
        const z = vertData[i + 1]

        const ao = vertData[i + 3]

        // We have ~64 bits of info to put in the key.  Bitwise arithmetic in JS just operates on 32 bits.
        // So unfortunately we will need to use more than one number - so use a pair/tuple.
        // Note that this key/map stuff is the slowest part of this code, and the choice of key data type here influences performance a lot.
        // The hash table key comprises two numbers:
        const key_a = x | (y << 8) | (z << 16) | (1 << 24) // Set bit 24 to distinguish from 0 = empty key.
        //console.assert(key_a != 0)
        const key_b = packedRgb | ((ao & 240) << 20) // ao-mesher only gives us 4 different AO values, for which the top (left) 4 bits of the ao value are enough to distinguish them.
        // AND with 240 = 0b1111000 to isolate those four upper bits, then shift to the left past the packed RGB by 24 - 4 bits.  Note that we don't want to set the sign bit (bit 31) of key_b, or we get a negative number
        // when we insert into the Uint32Array, which messes up our hash table.

        // Lookup in hash table
        const result = hashTableLookUp(bucketData, wrapMask, key_a, key_b)
        let v_i = 0
        if ((result! & 0x80000000) == 0) {
          // If vert is already in the table:
          v_i = result!
        } else {
          // If vert has not been added yet:
          v_i = next_v_i++
          const bucket_i = result! & 0x7fffffff // Zero leftmost bit.
          //console.assert(bucket_i <= numBuckets)
          // Insert key and vertex index into hash table.
          bucketData[bucket_i * 3] = key_a // Set key in hash table
          bucketData[bucket_i * 3 + 1] = key_b // Set key in hash table
          bucketData[bucket_i * 3 + 2] = v_i // Set value in hash table

          const posOffset = v_i * 3
          positions[posOffset] = fx(x)
          positions[posOffset + 1] = fz(y)
          positions[posOffset + 2] = -fy(z)

          // color[3] is ao so it needs to be scaled 0-1 range and then we divide again with 255 to scale the rgb values to 0-1
          const scale = (ao * (1.0 / 255) * intensity + offset) * (1.0 / 255)
          const colOffset = v_i * 4
          colors[colOffset] = r * scale
          colors[colOffset + 1] = g * scale
          colors[colOffset + 2] = b * scale
          colors[colOffset + 3] = 1
        }
        indices[index_i++] = v_i

        i += 8
      }

      const curIndicesLen = index_i
      if (!flipX) {
        const a = indices[curIndicesLen - 1]
        indices[curIndicesLen - 1] = indices[curIndicesLen - 2]
        indices[curIndicesLen - 2] = a
      }
    }

    const numMergedVerts = next_v_i
    //console.assert(numMergedVerts <= numUnmergedVerts)
    //console.assert(index_i == indices.length) // We should have set all vert indices now.
    //console.log('vox-reader.ts: vert data creation with merging took ' + (performance.now() - startTime) + ' ms. (indices.length: ' + indices.length + ')')

    let sized = [originalSize.x, originalSize.y, originalSize.z]

    // Check the number of merged vertices we have.  If we have less than 2^16 = 65536 merged vertices, then we know
    // all our index values are < 65536, and can therefore be stored in 16 bit unsigned ints.
    // So convert indices to a Uint16Array if this is the case.
    // This saves GPU mem.
    const finalIndices = numMergedVerts < 65536 ? Uint16Array.from(indices) : indices

    // trim positions array to actual part of it used.
    const positionsLenUsed = numMergedVerts * 3 // 3 floats per merged vert.
    //console.assert(positionsLenUsed <= positions.length, "positionsLenUsed: " + positionsLenUsed + ", positions.length: " + positions.length)
    const trimmedPositions = positions.slice(0, positionsLenUsed)

    // Trim color array to actual part of it used.
    const colLenUsed = numMergedVerts * 4 // 4 floats per merged vert.
    //console.assert(colLenUsed <= colors.length, "colLenUsed: " + colLenUsed + ", colors.length: " + colors.length)

    const trimmedColors = colors.slice(0, colLenUsed)

    // console.log(positions.slice(0, 20))
    // console.log(colliderPositions.slice(0, 20))

    callback({
      positions: trimmedPositions,
      indices: finalIndices,
      colors: trimmedColors,
      size: sized,
      ...(wantCollider ? makeCollider(fx, fy, fz, field) : {}),
    })
  })
}

const makeCollider = (fx: any, fy: any, fz: any, field: ndarray.NdArray<Uint16Array>): VoxDataColliderInfo => {
  // Convert existing field to one that records whether any voxel is present
  for (let i = 0; i < field.data.length; ++i) {
    field.data[i] = field.data[i] >> 15
  }

  let vertData: Uint8Array = createAOMesh(field)

  let colliderPositions = [] // new Float32Array(verts * 3)
  let colliderIndices = [] // new Uint16Array(verts)

  let i = 0
  let vi = 0

  while (i < vertData.length) {
    for (let j = 0; j < 3; j++) {
      // be aware of the coordinate flip, converting coordinate system for y and z
      const x = vertData[i] // all values are uint8s so should be in the range of 0-255
      const y = vertData[i + 2]
      const z = vertData[i + 1]

      colliderPositions.push(fx(x), fz(y), -fy(z))
      colliderIndices.push(vi)

      i += 8
      vi++
    }
  }

  return { colliderPositions, colliderIndices }
}
