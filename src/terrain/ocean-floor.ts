import type { Chunk, ChunkObserver } from './chunk-system'
import { addCuboid, removeCollider } from '../physics/world'
import { Color3, Mesh, SceneContext } from '@babylonjs/lite'

export default class OceanFloor implements ChunkObserver {
  private readonly _mesh: Mesh
  private readonly size: number
  private readonly halfSize: number
  private instances: Map<string, Mesh> = new Map()

  constructor(size: number, scene: SceneContext) {
    this.size = size
    this.halfSize = size * 0.5

    const oceanFloorTexture = (undefined as any /* todo(lite): new BABYLON.Texture(process.env.ASSET_PATH + '/textures/subgrid.png', scene) */)
    oceanFloorTexture.uScale = this.size
    oceanFloorTexture.vScale = this.size

    const oceanFloorMaterial = (undefined as any /* todo(lite): new BABYLON.StandardMaterial('skybox/ocean-floor', scene) */)
    oceanFloorMaterial.diffuseColor.set(0.2, 0.2, 0.2)
    oceanFloorMaterial.ambientTexture = oceanFloorTexture
    oceanFloorMaterial.specularColor = ([0.1, 0.1, 0.1] as Color3)
    oceanFloorMaterial.fogEnabled = true

    this._mesh = (undefined as any /* todo(lite): BABYLON.MeshBuilder.CreateGround('ocean_floor_original', { width: this.size, height: this.size, subdivisions: 1 }, scene) */)
    this._mesh.material = oceanFloorMaterial
    this._mesh.position.set(this.halfSize, -1024, this.halfSize)
    this._mesh.setEnabled(false) // instanced, dont need to render the original mesh
    this._mesh.receiveShadows = true
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
