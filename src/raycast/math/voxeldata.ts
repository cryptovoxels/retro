import { vec3, type Vec3, type Vec3Arg } from 'wgpu-matrix'
import { Bounds } from './bounds'

type byte = number

/*
 
  special case 0 = air
  bits 0..5 - 6 bit color (only 63 colors)
  bits 6..7:
    00: Diffuse
    01: Glass
    10: Metal
    11: Emitter

*/

/*

  ## .meke (mapped efficient kernel encoded)

  a sparse, gpu-ready voxel format designed for high-density voxel fields. optimized 
  for webgpu.

  # structure

  1. header (32 bytes): * `0x4D454B45` (magic "MEKE")
    * world dimensions ($w, h, d$)
    * directory dimensions ($dw, dh, dd$)
    * brick pool count
  2. directory (page table):
    * a 3d array of `uint32` indices.
    * maps chunks to specific bricks in the pool. 
    * index `0` is reserved for **wātea** (empty air).
  3. brick pool: * a contiguous blob of $8 \times 8 \times 8$ (`512` byte) voxels.
    * deduplicated via binary fingerprinting to keep file sizes **tū meke**.

  ### why use it?
  * zero finangling: slices straight from `arraybuffer` to `gpu_texture`.
  * cache local: spatial $8^3$ chunks maximize gpu texture cache hits.
  * sparse: only stores unique, non-empty geometry. 

*/

export class VoxelData {
  words: Uint32Array

  // Cache these as primitives for speed in the inner loops
  readonly shape: Vec3

  constructor(shape: Vec3) {
    this.shape = shape

    const totalBytes = shape[0] * shape[1] * shape[2]
    // Each Uint32 holds 4 bytes
    this.words = new Uint32Array(Math.ceil(totalBytes / 4))
  }

  // Set voxel
  set(p: Vec3, value: byte): void {
    if (!this.contains(p)) return

    const byteIdx = p[0] + p[1] * this.shape[0] + p[2] * this.shape[0] * this.shape[1]
    this.setByByteIndex(byteIdx, value)
  }

  // Get voxel
  get(p: Vec3): byte {
    if (!this.contains(p)) return 0

    const byteIdx = p[0] + p[1] * this.shape[0] + p[2] * this.shape[0] * this.shape[1]
    const wordIdx = byteIdx >> 2
    const shift = (byteIdx & 3) << 3

    return (this.words[wordIdx] >> shift) & 0xff
  }

  // Generate a range with a function
  generate(b: Bounds, func: (p: Vec3) => byte): void {
    // Clamp the generate bounds to the VoxelData shape
    const clamped = b.clamp(vec3.create(0, 0, 0), this.shape)

    const p: Vec3 = vec3.create(0, 0, 0)

    for (let z = clamped.z1; z < clamped.z2; z++) {
      p[2] = z
      for (let y = clamped.y1; y < clamped.y2; y++) {
        p[1] = y
        for (let x = clamped.x1; x < clamped.x2; x++) {
          p[0] = x
          this.set(p, func(p))
        }
      }
    }
  }

  clone(): VoxelData {
    const vox = new VoxelData(this.shape)
    vox.words.set(this.words)
    return vox
  }

  /**
   * Copy non-air voxels from this volume into `target`, placing this (0,0,0)
   * at integer position `p` in target space (typically world-aligned).
   */
  copy(p: Vec3Arg, target: VoxelData): void {
    const sw = this.shape[0]
    const sh = this.shape[1]
    const sd = this.shape[2]
    const tw = target.shape[0]
    const th = target.shape[1]
    const td = target.shape[2]
    const ox = p[0]
    const oy = p[1]
    const oz = p[2]
    const q: Vec3 = vec3.create(0, 0, 0)

    for (let z = 0; z < sd; z++) {
      const tz = oz + z
      if (tz < 0 || tz >= td) continue
      for (let y = 0; y < sh; y++) {
        const ty = oy + y
        if (ty < 0 || ty >= th) continue
        for (let x = 0; x < sw; x++) {
          const tx = ox + x
          if (tx < 0 || tx >= tw) continue
          vec3.set(x, y, z, q)
          const v = this.get(q)
          if (v === 0) continue
          vec3.set(tx, ty, tz, q)
          target.set(q, v)
        }
      }
    }
  }

  // Fast fill to zero
  clear(): void {
    this.words.fill(0)
  }

  // Fill range with value
  fill(value: byte, b: Bounds = new Bounds(vec3.create(0, 0, 0), this.shape)): void {
    // Clamp the fill bounds to the VoxelData shape
    const clamped = b.clamp(vec3.create(0, 0, 0), this.shape)

    if (clamped.x2 <= clamped.x1 || clamped.y2 <= clamped.y1 || clamped.z2 <= clamped.z1) return

    // Create the 32-bit word for aligned filling
    const fillWord = (value << 24) | (value << 16) | (value << 8) | value

    const strideY = this.shape[0]
    const strideZ = this.shape[0] * this.shape[1]

    for (let z = clamped.z1; z < clamped.z2; z++) {
      const zOffset = z * strideZ
      for (let y = clamped.y1; y < clamped.y2; y++) {
        const yOffset = y * strideY

        const rowByteStart = clamped.x1 + yOffset + zOffset
        const rowByteEnd = clamped.x2 + yOffset + zOffset
        let currByte = rowByteStart

        // 1. Handle unaligned leading bytes
        while (currByte < rowByteEnd && (currByte & 3) !== 0) {
          this.setByByteIndex(currByte++, value)
        }

        // 2. Fill middle aligned words (4 bytes at a time)
        let currWordIdx = currByte >> 2
        const endWordIdx = rowByteEnd >> 2

        while (currWordIdx < endWordIdx) {
          this.words[currWordIdx++] = fillWord
          currByte += 4
        }

        // 3. Handle unaligned trailing bytes
        while (currByte < rowByteEnd) {
          this.setByByteIndex(currByte++, value)
        }
      }
    }
  }

  private contains(p: Vec3): boolean {
    return p[0] >= 0 && p[0] < this.shape[0] && p[1] >= 0 && p[1] < this.shape[1] && p[2] >= 0 && p[2] < this.shape[2]
  }

  setByByteIndex(byteIdx: number, value: byte): void {
    const wordIdx = byteIdx >> 2
    const shift = (byteIdx & 3) << 3

    // Clear the 8 bits at the shift position, then OR in the new value
    this.words[wordIdx] = (this.words[wordIdx] & ~(0xff << shift)) | (value << shift)
  }

  // Give a string representation as a .xpm style

  get inspect(): string {
    const [width, height, depth] = this.shape
    let out = `[VoxelData ${width}x${height}x${depth}]\n`

    // ASCII Ramp: . (air), : (low), o (med), 8 (high), # (max/emitter)
    const getChar = (val: number) => {
      if (val === 0) return '. '
      const type = (val >> 6) & 0x03 // Bits 6-7
      if (type === 0b11) return '!!' // Emitter
      if (type === 0b10) return 'MM' // Metal
      if (val > 32) return '88'
      return 'oo'
    }

    for (let z = 0; z < depth; z++) {
      out += `\n--- Slice Z: ${z} ---\n`
      for (let y = 0; y < height; y++) {
        let row = ''
        for (let x = 0; x < width; x++) {
          const val = this.get(vec3.fromValues(x, y, z))
          row += getChar(val)
        }
        out += row + '\n'
      }
    }

    return out
  }

  // Save to .meke
  async save(): Promise<ArrayBuffer> {
    const BS = 8
    const [w, h, d] = this.shape
    const [dw, dh, dd] = [Math.ceil(w / BS), Math.ceil(h / BS), Math.ceil(d / BS)]

    const cache = new Map<string, number>()
    const dir = new Uint32Array(dw * dh * dd)
    const pool: Uint8Array[] = [new Uint8Array(512)] // Index 0 is Wātea

    const p = vec3.create(0, 0, 0)

    for (let z = 0; z < dd; z++) {
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const brick = new Uint8Array(512)
          let solid = false

          for (let i = 0; i < 512; i++) {
            const gx = x * BS + (i & 7)
            const gy = y * BS + ((i >> 3) & 7)
            const gz = z * BS + ((i >> 6) & 7)
            vec3.set(gx, gy, gz, p)

            if (gx < w && gy < h && gz < d) {
              const v = this.get(p)
              if (v !== 0) {
                solid = true
                brick[i] = v
              }
            }
          }

          const dIdx = x + y * dw + z * dw * dh
          if (!solid) {
            dir[dIdx] = 0
          } else {
            const key = getBrickHash(brick)
            if (cache.has(key)) {
              dir[dIdx] = cache.get(key)!
            } else {
              const id = pool.length
              pool.push(brick)
              cache.set(key, id)
              dir[dIdx] = id
            }
          }
        }
      }
    }

    const head = new Uint32Array([0x4d454b45, w, h, d, dw, dh, dd, pool.length])

    // Cast to BlobPart[] for typescripts butthole
    const parts: BlobPart[] = [head.buffer as ArrayBuffer, dir.buffer as ArrayBuffer, ...pool.map((b) => b.buffer as ArrayBuffer)]

    return new Blob(parts).arrayBuffer()
  }

  static load(buffer: ArrayBuffer): VoxelData {
    const head = new Uint32Array(buffer, 0, 8)

    if (head[0] !== 0x4d454b45) {
      throw new Error('Not a .meke file?')
    }

    const [_, w, h, d, dw, dh, dd] = head
    const vox = new VoxelData(vec3.fromValues(w, h, d))

    const dir = new Uint32Array(buffer, 32, dw * dh * dd)
    const poolOffset = 32 + dw * dh * dd * 4
    const pool = new Uint8Array(buffer, poolOffset)

    const BS = 8
    for (let z = 0; z < dd; z++) {
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const id = dir[x + y * dw + z * dw * dh]
          if (id === 0) continue

          const bStart = id * 512
          for (let i = 0; i < 512; i++) {
            const val = pool[bStart + i]
            if (val === 0) continue

            const gx = x * BS + (i & 7)
            const gy = y * BS + ((i >> 3) & 7)
            const gz = z * BS + ((i >> 6) & 7)

            // Only set if within original Rahi
            if (gx < w && gy < h && gz < d) {
              vox.set(vec3.fromValues(gx, gy, gz), val)
            }
          }
        }
      }
    }
    return vox
  }
}

// Uses a 1:1 byte-to-string mapping for Map-keying.
// Don't @ me bro
const _hashEngine = new TextDecoder('latin1')

function getBrickHash(brick: Uint8Array): string {
  return _hashEngine.decode(brick)
}
