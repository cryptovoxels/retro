import { mat4, quat, vec3, type Mat4, type Quat, type Vec3 } from 'wgpu-matrix'
import { VoxelData } from './math/voxeldata'

/**
 * Tiny Babylon-shaped scenegraph sketch on wgpu-matrix.
 * Just TransformNode + Mesh — no materials, no render loop.
 * Mutate position/rotationQuaternion/scaling then call markDirty().
 */
export class TransformNode {
  name = ''
  position: Vec3 = vec3.create(0, 0, 0)
  rotationQuaternion: Quat = quat.identity()
  scaling: Vec3 = vec3.create(1, 1, 1)
  parent: TransformNode | null = null

  private _children: TransformNode[] = []
  private _localDirty = true
  private _worldDirty = true
  private _local: Mat4 = mat4.identity()
  private _world: Mat4 = mat4.identity()

  setParent(parent: TransformNode | null) {
    if (this.parent) {
      const i = this.parent._children.indexOf(this)
      if (i >= 0) this.parent._children.splice(i, 1)
    }
    this.parent = parent
    if (parent) parent._children.push(this)
    this.markDirty()
  }

  markDirty() {
    this._localDirty = true
    this._worldDirty = true
    for (const c of this._children) c.markDirty()
  }

  getLocalMatrix(): Mat4 {
    if (this._localDirty) {
      // T * R * S
      mat4.identity(this._local)
      mat4.translate(this._local, this.position, this._local)
      mat4.multiply(this._local, mat4.fromQuat(this.rotationQuaternion), this._local)
      mat4.scale(this._local, this.scaling, this._local)
      this._localDirty = false
    }
    return this._local
  }

  getWorldMatrix(): Mat4 {
    if (this._worldDirty) {
      const local = this.getLocalMatrix()
      if (this.parent) mat4.multiply(this.parent.getWorldMatrix(), local, this._world)
      else mat4.copy(local, this._world)
      this._worldDirty = false
    }
    return this._world
  }
}

export class Mesh extends TransformNode {
  data: VoxelData
  shape: Vec3

  constructor(shape?: Vec3) {
    super()
    this.shape = shape ? vec3.clone(shape) : vec3.fromValues(1, 1, 1)
    this.data = new VoxelData(this.shape)
    this.data.clear()
  }
}
