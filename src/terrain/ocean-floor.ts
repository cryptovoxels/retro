import type { Chunk, ChunkObserver } from './chunk-system'
import { addCuboid, removeCollider } from '../physics/world'
import { Mesh, SceneContext } from '@babylonjs/lite'
import { stubInstancedMesh } from './stub-mesh'

export default class OceanFloor implements ChunkObserver {
  private readonly _mesh: Mesh & { instances: Mesh[] }
  private readonly size: number
  private readonly halfSize: number
  private instances: Map<string, Mesh> = new Map()

  constructor(size: number, _scene: SceneContext) {
    this.size = size
    this.halfSize = size * 0.5

    // todo(lite): subgrid texture + instanced ground mesh
    this._mesh = stubInstancedMesh()
    this._mesh.position.set(this.halfSize, -1024, this.halfSize)
    this._mesh.setEnabled(false)
  }

  get mesh(): Mesh {
    return this._mesh
  }

  createInstance(x: number, y: number): Mesh {
    const i = this._mesh.createInstance(`ocean_floor_i_${x}_${y}`)
    i.position.x = this.size * x + this.halfSize
    i.position.y = -6
    i.position.z = this.size * y + this.halfSize
    const hy = 0.5
    addCuboid(`ocean-floor-${x}-${y}`, { x: this.halfSize, y: hy, z: this.halfSize }, { x: i.position.x, y: i.position.y - hy, z: i.position.z })
    return i
  }

  getInstances() {
    return this._mesh.instances
  }

  onChunkLoaded(chunk: Chunk): void {
    const key = `${chunk.gridX}_${chunk.gridZ}`
    if (!this.instances.has(key)) {
      const instance = this.createInstance(chunk.gridX, chunk.gridZ)
      this.instances.set(key, instance)
    }
  }

  onChunkUnloaded(chunk: Chunk): void {
    const key = `${chunk.gridX}_${chunk.gridZ}`
    const instance = this.instances.get(key)
    if (instance) {
      removeCollider(`ocean-floor-${chunk.gridX}-${chunk.gridZ}`)
      instance.dispose()
      this.instances.delete(key)
    }
  }
}
