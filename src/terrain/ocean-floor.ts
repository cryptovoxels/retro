import type { Chunk, ChunkObserver } from './chunk-system'

export default class OceanFloor implements ChunkObserver {
  private readonly _mesh: BABYLON.Mesh
  private readonly size: number
  private readonly halfSize: number
  private readonly parent: BABYLON.TransformNode
  private instances: Map<string, BABYLON.InstancedMesh> = new Map()

  constructor(size: number, scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
    this.size = size
    this.halfSize = size * 0.5

    const oceanFloorTexture = new BABYLON.Texture(process.env.ASSET_PATH + '/textures/subgrid.png', scene)
    oceanFloorTexture.uScale = this.size
    oceanFloorTexture.vScale = this.size

    const oceanFloorMaterial = new BABYLON.StandardMaterial('skybox/ocean-floor', scene)
    oceanFloorMaterial.diffuseColor.set(0.2, 0.2, 0.2)
    oceanFloorMaterial.ambientTexture = oceanFloorTexture
    oceanFloorMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1)
    oceanFloorMaterial.fogEnabled = true

    this._mesh = BABYLON.MeshBuilder.CreateGround('ocean_floor_original', { width: this.size, height: this.size, subdivisions: 1 }, scene)
    this._mesh.material = oceanFloorMaterial
    this._mesh.checkCollisions = true
    this._mesh.position.set(this.halfSize, -1024, this.halfSize)
    this._mesh.setEnabled(false) // instanced, dont need to render the original mesh
    this._mesh.parent = parent
    this._mesh.receiveShadows = true
    this.parent = parent
  }

  get mesh(): BABYLON.Mesh {
    return this._mesh
  }

  createInstance(x: number, y: number): BABYLON.InstancedMesh {
    const i = this._mesh.createInstance(`ocean_floor_i_${x}_${y}`)
    i.position.x = this.size * x + this.halfSize
    i.position.y = -6
    i.position.z = this.size * y + this.halfSize
    i.parent = this.parent
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
      instance.dispose()
      this.instances.delete(key)
    }
  }
}
