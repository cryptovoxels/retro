import type Parcel from './parcel'
import { getFieldShape } from '../common/voxels/helpers'
import type { ParcelMesher } from './parcel-mesher'
// import aoMeshVertexShader from './shaders/ao-mesh.vsh'
// import aoMeshPixelShader from './shaders/ao-mesh.fsh'
import { createGlassMaterial, createVoxelMaterial } from './materials'
import { defaultColors } from '../common/content/blocks'
import { runCompute } from './mono-pool'

// Vertex-based ambient occlusion Shader
// BABYLON.Effect.ShadersStore['aoMeshVertexShader'] = aoMeshVertexShader
// BABYLON.Effect.ShadersStore['aoMeshPixelShader'] = aoMeshPixelShader

export interface VoxelisationJob {
  renderJob: number
  fieldShape: [number, number, number]
  voxels: string
  island?: string
}

export type CompletedRawVoxelizedMeshData = RawVoxelizedMeshData & {
  renderJob: number // gets added by the worker when it is processed
}

export interface RawVoxelizedMeshData {
  opaquePositions: Float32Array
  opaqueIndices: Uint32Array
  opaqueNormals: Float32Array
  ambientOcclusion: Float32Array
  opaqueTextureIndices: Float32Array
  glassPositions: Float32Array
  glassIndices: Uint32Array
  glassNormals: Float32Array
  colliderPositions: Float32Array
  colliderIndices: Uint32Array
  colliderNormals: Float32Array
}

export const GLASS_MAX_VIEW_DISTANCE = 64

export class VoxelField {
  private readonly scene: BABYLON.Scene
  private readonly mesher: ParcelMesher
  private jobs: Record<number, (opaque: BABYLON.Mesh, glass: BABYLON.Mesh, collider: BABYLON.Mesh) => void> = {}
  private renderJob = 0

  constructor(scene: BABYLON.Scene, mesher: ParcelMesher) {
    this.scene = scene
    this.mesher = mesher
  }

  async initialize() {
    // No message listener needed with Comlink - direct method calls
  }

  generate(parcel: Parcel, data: RawVoxelizedMeshData | null, callback: (opaque: BABYLON.Mesh, glass: BABYLON.Mesh, collider: BABYLON.Mesh) => void) {
    // apply loading material
    if (!VoxelField.loadingMaterial) {
      VoxelField.loadingMaterial = this.createLoadingMaterial()
    }

    const opaqueMesh = new BABYLON.Mesh(`voxel-field/opaque-${parcel.id}`, this.scene)
    opaqueMesh.setEnabled(false)

    const glassMesh = new BABYLON.Mesh(`voxel-field/glass-${parcel.id}`, this.scene)
    glassMesh.setEnabled(false)
    glassMesh.material = createGlassMaterial(this.scene, {})

    const colliderMesh = new BABYLON.Mesh(`voxel-field/collider-${parcel.id}`, this.scene)
    colliderMesh.setEnabled(false)
    colliderMesh.visibility = 0

    // console.log('generate voxel material for parcel', parcel.id, parcel.tileset, parcel.tilesetTexture, parcel.needsCustomMaterial())
    if (parcel.voxelMesh && parcel.needsCustomMaterial()) {
      if (parcel.tilesetTexture) {
        // texture has already been loaded, we re-use the parcel's custom material
        opaqueMesh.material = parcel.voxelMesh!.material
      }
    } else {
      opaqueMesh.material = VoxelField.loadingMaterial
    }

    if (!opaqueMesh.material) {
      opaqueMesh.material = parcel.voxelMesh!.material
    }
    this.setVoxelMaterial(parcel, opaqueMesh)
    // we already got the data from somewhere, we don't need to call a worker
    if (data) {
      this.applyData(data, opaqueMesh, glassMesh, colliderMesh)
      callback(opaqueMesh, glassMesh, colliderMesh)
      return
    }

    if (!parcel.voxels) {
      // eslint-disable-next-line no-console
      console.error('No field or voxels for parcel, this will break voxelisation')
    }

    const renderJob = this.renderJob++
    this.jobs[renderJob] = callback

    const voxelJob: VoxelisationJob = {
      renderJob,
      fieldShape: getFieldShape(parcel),
      island: parcel.island,
      voxels: parcel.voxels || '',
    }

    runCompute((worker) => worker.processVoxelisation(voxelJob))
      .then((result) => {
        const jobCallback = this.jobs[result.renderJob]
        if (jobCallback) {
          this.applyData(result, opaqueMesh, glassMesh, colliderMesh)
          jobCallback(opaqueMesh, glassMesh, colliderMesh)
          delete this.jobs[result.renderJob]
        }
      })
      .catch((error) => {
        console.error('Voxel generation failed:', error)
        const jobCallback = this.jobs[renderJob]
        if (jobCallback) {
          jobCallback(opaqueMesh, glassMesh, colliderMesh)
          delete this.jobs[renderJob]
        }
      })
  }

  setVoxelMaterial(parcel: Parcel, mesh: BABYLON.Mesh) {
    if (parcel.tilesetTexture) {
      // texture has already been loaded and cached
      mesh.material = this.createVoxelMaterial(parcel, parcel.tilesetTexture)
      return
    }

    // this parcel doesn't have a custom tileset, use the default one (default palette colors will be respected by the material cache)
    if (!parcel.needsCustomMaterial() || !parcel.tileset) {
      mesh.material = this.createVoxelMaterial(parcel, this.mesher.defaultTileset)
      return
    }

    const texture = new BABYLON.Texture(process.env.IMG_HOST + '/' + parcel.tileset.slice(1), this.scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE, () => {
      parcel.tilesetTexture = texture
      mesh.material = this.createVoxelMaterial(parcel, texture)
    })
  }

  static loadingMaterial: BABYLON.Material | null = null

  private createLoadingMaterial() {
    const palette: Array<BABYLON.Color3> = defaultColors.map((c) => {
      const col = BABYLON.Color3.FromHexString(c)
      const luminosity = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b
      return new BABYLON.Color3(luminosity, luminosity, luminosity)
    })
    return createVoxelMaterial(`parcels/loading/voxel-field`, this.scene, this.mesher.emptyTileset, palette, 1.5, 128, 4.0)
  }

  private createVoxelMaterial(parcel: Parcel, texture: BABYLON.Texture): BABYLON.Material {
    const palette: Array<BABYLON.Color3> | null = parcel.paletteColors
    return createVoxelMaterial(`voxel-field/parcel_${parcel.id}`, this.scene, texture, palette || undefined, 1.5, 128, 4.0)
  }

  private applyData(data: RawVoxelizedMeshData, opaqueMesh: BABYLON.Mesh, glassMesh: BABYLON.Mesh, colliderMesh: BABYLON.Mesh) {
    const { opaquePositions, opaqueIndices, opaqueNormals, ambientOcclusion, opaqueTextureIndices, glassPositions, glassIndices, glassNormals, colliderPositions, colliderIndices, colliderNormals } = data
    if (opaquePositions.length > 0) {
      this.applyVertexDataToMesh(opaquePositions, opaqueIndices, opaqueMesh, opaqueNormals)
      opaqueMesh.setVerticesData('block', opaqueTextureIndices, false, 1)
      opaqueMesh.setVerticesData('ambientOcclusion', ambientOcclusion, false, 1)
    }
    if (glassPositions.length > 0) {
      this.applyVertexDataToMesh(glassPositions, glassIndices, glassMesh, glassNormals)
    }
    if (colliderPositions.length > 0) {
      this.applyVertexDataToMesh(colliderPositions, colliderIndices, colliderMesh, colliderNormals)
    }
  }

  private applyVertexDataToMesh(positions: Float32Array, indices: Uint32Array, mesh: BABYLON.Mesh, normals: Float32Array, uvs?: Float32Array, colors?: Float32Array) {
    const d = new BABYLON.VertexData()
    d.positions = positions
    d.indices = indices
    d.normals = normals
    if (uvs) {
      d.uvs = uvs
    }
    if (colors) {
      d.colors = colors
    }
    d.applyToMesh(mesh)
  }
}
