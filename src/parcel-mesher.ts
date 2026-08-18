import { RawVoxelizedMeshData, VoxelField } from './voxel-field'
import { BakedVoxelField } from './baked-voxel-field'
import Parcel from './parcel'
import { fetchAtlasTexture } from './textures/textures'

/**
 * ParcelMesher exposes the ways to mesh and display a parcel in a semi-consistent manner
 */
export class ParcelMesher {
  private voxelField: VoxelField
  private bakedVoxelField: BakedVoxelField

  constructor(private scene: BABYLON.Scene) {
    this.voxelField = new VoxelField(scene, this)
    this.bakedVoxelField = new BakedVoxelField(scene, this)
  }

  emptyTileset: BABYLON.Texture = new BABYLON.Texture('/textures/atlas-empty.png', this.scene)
  private _defaultTileset: BABYLON.Nullable<BABYLON.Texture> = null

  get defaultTileset(): BABYLON.Texture {
    if (!this._defaultTileset) {
      throw new Error('default atlas not loaded, mesher has not been initialised')
    }
    return this._defaultTileset
  }

  async initialize() {
    this._defaultTileset = await fetchAtlasTexture(this.scene)

    await Promise.all([this.voxelField.initialize(), this.bakedVoxelField.initialize()])
  }

  generate(parcel: Parcel, data: RawVoxelizedMeshData | null, callback: (opaque: BABYLON.Mesh, glass: BABYLON.Mesh, colliderVoxels: Int32Array) => void) {
    return this.voxelField.generate(parcel, data, callback)
  }

  generateBaked(parcel: Parcel, callback: (opaque: BABYLON.Mesh, glass: BABYLON.Mesh) => void, texture: BABYLON.Texture) {
    return this.bakedVoxelField.generate(parcel, callback, texture)
  }

  resetTileSet(parcel: Parcel) {
    if (!this._defaultTileset || !(parcel.voxelMesh?.material instanceof BABYLON.ShaderMaterial)) {
      return
    }
    parcel.voxelMesh.material.setTexture('tileMap', this._defaultTileset)
  }

  setVoxelMaterial(parcel: Parcel, mesh: BABYLON.Mesh) {
    this.voxelField.setVoxelMaterial(parcel, mesh)
  }
}
