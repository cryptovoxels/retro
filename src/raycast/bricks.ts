/** Sparse 8^3 brick pool for the raycaster GPU. Brick 0 = watea (air). */

export const VOX_RES = 64
export const BRICK = 8
export const DIR_AXIS = VOX_RES / BRICK // 8
export const DIR_LEN = DIR_AXIS ** 3 // 512
export const BRICK_BYTES = BRICK ** 3 // 512
export const BRICK_WORDS = BRICK_BYTES / 4 // 128
/** 128MB brick pool — under default maxStorageBufferBindingSize */
export const MAX_BRICKS = 262_144
export const MAX_CHUNKS = 4096
export const DIR_WORDS_PER_CHUNK = DIR_LEN
export const GPU_BRICK_BYTES = MAX_BRICKS * BRICK_BYTES
export const GPU_DIR_BYTES = MAX_CHUNKS * DIR_LEN * 4

const AIR = 0xff
const hashEngine = new TextDecoder('latin1')

export function brickHash(brick: Uint8Array): string {
  return hashEngine.decode(brick)
}

export type Brickified = {
  /** local brick ids: 0 = air, 1..n index into bricks */
  directory: Uint32Array
  /** concatenated unique bricks, length n * 512 */
  brickBytes: Uint8Array
  /** hash per unique brick (length n) */
  hashes: string[]
}

/** Pack a dense 64^3 VoxelData words (0xff air) into a deduped local brick set. */
export function brickify(words: Uint32Array): Brickified {
  const directory = new Uint32Array(DIR_LEN)
  const cache = new Map<string, number>()
  const unique: Uint8Array[] = []
  const hashes: string[] = []
  const brick = new Uint8Array(BRICK_BYTES)

  for (let bz = 0; bz < DIR_AXIS; bz++) {
    for (let by = 0; by < DIR_AXIS; by++) {
      for (let bx = 0; bx < DIR_AXIS; bx++) {
        brick.fill(AIR)
        let solid = false
        for (let lz = 0; lz < BRICK; lz++) {
          for (let ly = 0; ly < BRICK; ly++) {
            for (let lx = 0; lx < BRICK; lx++) {
              const x = bx * BRICK + lx
              const y = by * BRICK + ly
              const z = bz * BRICK + lz
              const linear = x + y * VOX_RES + z * VOX_RES * VOX_RES
              const v = (words[linear >> 2] >> ((linear & 3) * 8)) & 0xff
              if (v !== AIR) {
                solid = true
                brick[lx + ly * BRICK + lz * BRICK * BRICK] = v
              }
            }
          }
        }
        const dIdx = bx + by * DIR_AXIS + bz * DIR_AXIS * DIR_AXIS
        if (!solid) {
          directory[dIdx] = 0
          continue
        }
        const key = brickHash(brick)
        let local = cache.get(key)
        if (local == null) {
          local = unique.length + 1
          cache.set(key, local)
          unique.push(brick.slice())
          hashes.push(key)
        }
        directory[dIdx] = local
      }
    }
  }

  const brickBytes = new Uint8Array(unique.length * BRICK_BYTES)
  for (let i = 0; i < unique.length; i++) brickBytes.set(unique[i], i * BRICK_BYTES)
  return { directory, brickBytes, hashes }
}

export type PoolStats = {
  used: number
  capacity: number
  bytes: number
  dedupHits: number
  allocFails: number
}

export class BrickPool {
  readonly words = new Uint32Array(MAX_BRICKS * BRICK_WORDS)
  readonly ref = new Uint32Array(MAX_BRICKS)
  private free: number[] = []
  private byHash = new Map<string, number>()
  private nextId = 1
  used = 0
  dedupHits = 0
  allocFails = 0
  private loggedFull = false
  /** brick ids that need a GPU upload */
  readonly dirty: number[] = []

  constructor() {
    // brick 0 is watea — filled with air, never allocated
    this.words.fill(0xffff_ffff, 0, BRICK_WORDS)
  }

  stats(): PoolStats {
    return {
      used: this.used,
      capacity: MAX_BRICKS - 1,
      bytes: this.used * BRICK_BYTES,
      dedupHits: this.dedupHits,
      allocFails: this.allocFails,
    }
  }

  /** resolve local brickified into global directory ids; returns null if pool full */
  install(local: Brickified): Uint32Array | null {
    const global = new Uint32Array(DIR_LEN)
    const mapped = new Uint32Array(local.hashes.length + 1)
    for (let i = 0; i < local.hashes.length; i++) {
      const id = this.retainOrAlloc(local.hashes[i], local.brickBytes.subarray(i * BRICK_BYTES, (i + 1) * BRICK_BYTES))
      if (id === 0) {
        // roll back what we retained this call
        for (let j = 1; j <= i; j++) this.release(mapped[j])
        return null
      }
      mapped[i + 1] = id
    }
    for (let i = 0; i < DIR_LEN; i++) global[i] = mapped[local.directory[i]]
    return global
  }

  releaseDirectory(directory: Uint32Array) {
    const seen = new Set<number>()
    for (let i = 0; i < directory.length; i++) {
      const id = directory[i]
      if (!id || seen.has(id)) continue
      seen.add(id)
      this.release(id)
    }
  }

  private retainOrAlloc(hash: string, bytes: Uint8Array): number {
    const existing = this.byHash.get(hash)
    if (existing) {
      this.ref[existing]++
      this.dedupHits++
      return existing
    }
    const id = this.allocId()
    if (id === 0) return 0
    const base = id * BRICK_WORDS
    const u32 = new Uint32Array(bytes.buffer, bytes.byteOffset, BRICK_WORDS)
    this.words.set(u32, base)
    this.ref[id] = 1
    this.byHash.set(hash, id)
    this.dirty.push(id)
    this.used++
    return id
  }

  private allocId(): number {
    const id = this.free.pop()
    if (id !== undefined) return id
    if (this.nextId >= MAX_BRICKS) {
      this.allocFails++
      if (!this.loggedFull) {
        console.error('raycast: brick pool full')
        this.loggedFull = true
      }
      return 0
    }
    return this.nextId++
  }

  release(id: number) {
    if (id <= 0) return
    if (this.ref[id] === 0) return
    this.ref[id]--
    if (this.ref[id] > 0) return
    // drop hash entry
    const base = id * BRICK_WORDS
    const bytes = new Uint8Array(this.words.buffer, base * 4, BRICK_BYTES)
    this.byHash.delete(brickHash(bytes))
    this.words.fill(0xffff_ffff, base, base + BRICK_WORDS)
    this.free.push(id)
    this.used--
  }

  /** set one voxel in a chunk directory; COW if brick shared. returns dirty brick id or 0 */
  setVoxel(directory: Uint32Array, x: number, y: number, z: number, value: number): number {
    const bx = x >> 3
    const by = y >> 3
    const bz = z >> 3
    const dIdx = bx + by * DIR_AXIS + bz * DIR_AXIS * DIR_AXIS
    let id = directory[dIdx]
    const lx = x & 7
    const ly = y & 7
    const lz = z & 7
    const linear = lx + ly * BRICK + lz * BRICK * BRICK

    if (id === 0) {
      if (value === AIR) return 0
      // need a fresh brick
      const brick = new Uint8Array(BRICK_BYTES)
      brick.fill(AIR)
      brick[linear] = value
      const hash = brickHash(brick)
      const nid = this.retainOrAlloc(hash, brick)
      if (!nid) return 0
      directory[dIdx] = nid
      return nid
    }

    if (this.ref[id] > 1) {
      // copy on write
      const src = id * BRICK_WORDS
      const copy = new Uint8Array(BRICK_BYTES)
      copy.set(new Uint8Array(this.words.buffer, src * 4, BRICK_BYTES))
      this.release(id)
      copy[linear] = value
      // if all air, clear directory
      let solid = false
      for (let i = 0; i < BRICK_BYTES; i++) {
        if (copy[i] !== AIR) {
          solid = true
          break
        }
      }
      if (!solid) {
        directory[dIdx] = 0
        return 0
      }
      const nid = this.retainOrAlloc(brickHash(copy), copy)
      directory[dIdx] = nid
      return nid
    }

    // unique brick — mutate in place, rehash
    const base = id * BRICK_WORDS
    const bytes = new Uint8Array(this.words.buffer, base * 4, BRICK_BYTES)
    const oldHash = brickHash(bytes)
    this.byHash.delete(oldHash)
    const wordIdx = base + (linear >> 2)
    const shift = (linear & 3) * 8
    this.words[wordIdx] = (this.words[wordIdx] & ~(0xff << shift)) | ((value & 0xff) << shift)
    let solid = false
    for (let i = 0; i < BRICK_BYTES; i++) {
      if (bytes[i] !== AIR) {
        solid = true
        break
      }
    }
    if (!solid) {
      this.release(id)
      directory[dIdx] = 0
      return 0
    }
    this.byHash.set(brickHash(bytes), id)
    this.dirty.push(id)
    return id
  }
}
