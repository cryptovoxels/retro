import { vec3, type Vec3, type Vec3Arg } from 'wgpu-matrix'

export class Bounds {
  min: Vec3
  max: Vec3

  constructor(min: Vec3 = vec3.create(0, 0, 0), max: Vec3 = vec3.create(0, 0, 0)) {
    // Clone to ensure this instance owns its own data
    this.min = vec3.clone(min)
    this.max = vec3.clone(max)
  }

  get x1(): number {
    return this.min[0]
  }

  get x2(): number {
    return this.max[0]
  }

  get y1(): number {
    return this.min[1]
  }

  get y2(): number {
    return this.max[1]
  }

  get z1(): number {
    return this.min[2]
  }

  get z2(): number {
    return this.max[2]
  }

  get width(): number {
    return this.max[0] - this.min[0]
  }

  get height(): number {
    return this.max[1] - this.min[1]
  }

  get depth(): number {
    return this.max[2] - this.min[2]
  }

  get volume(): number {
    return this.width * this.height * this.depth
  }

  get size(): Vec3 {
    return vec3.create(this.width, this.height, this.depth)
  }

  // Intersect with [lo, hi) per axis (matches VoxelData fill/generate half-open ranges)
  clamp(lo: Vec3Arg, hi: Vec3Arg): Bounds {
    return new Bounds(vec3.max<Vec3>(this.min, lo), vec3.min<Vec3>(this.max, hi))
  }

  // Test for intersection
  intersect(other: Bounds): boolean {
    return this.min[0] <= other.max[0] && this.max[0] >= other.min[0] && this.min[1] <= other.max[1] && this.max[1] >= other.min[1] && this.min[2] <= other.max[2] && this.max[2] >= other.min[2]
  }

  // Check if point is inside
  contains(p: Vec3): boolean {
    return p[0] >= this.min[0] && p[0] <= this.max[0] && p[1] >= this.min[1] && p[1] <= this.max[1] && p[2] >= this.min[2] && p[2] <= this.max[2]
  }

  // Return a new bounds object
  union(other: Bounds): Bounds {
    return new Bounds(vec3.min<Vec3>(this.min, other.min), vec3.max<Vec3>(this.max, other.max))
  }

  // Update this to include another
  encapsulate(other: Bounds): void {
    vec3.min<Vec3>(this.min, other.min, this.min)
    vec3.max<Vec3>(this.max, other.max, this.max)
  }

  clone(): Bounds {
    return new Bounds(this.min, this.max)
  }

  // Static method

  static create(minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0): Bounds {
    return new Bounds(vec3.create(minX, minY, minZ), vec3.create(maxX, maxY, maxZ))
  }
}
