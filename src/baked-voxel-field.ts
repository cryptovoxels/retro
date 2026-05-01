import { defaultColors } from '../common/content/blocks'
import { createWhiteTexture } from './textures/textures'
import { createLightmapMaterial } from './shaders/lightmap'
import { createGlassMaterial } from './materials'
import { getFieldShape } from '../common/voxels/helpers'
import type Parcel from './parcel'
import { createComlinkWorker } from '../common/helpers/comlink-worker'
import type { BakedVoxelizedMesh, BakedVoxelizerJobType, BakedVoxelizerWorkerAPI, ParcelVoxels } from './baked-voxelizer-worker'
import type { Scene } from './scene'
import type { ParcelMesher } from './parcel-mesher'

export class BakedVoxelField {
  private readonly scene: Scene
  private readonly whiteTexture: BABYLON.Texture
  private workerAPI: BakedVoxelizerWorkerAPI | null = null
  private workerCleanup: (() => void) | null = null
  private workerPromise: Promise<BakedVoxelizerWorkerAPI> | null = null
  private jobId = 0
  private mesher: ParcelMesher

  constructor(scene: Scene, mesher: ParcelMesher) {
    this.scene = scene
    this.mesher = mesher

    this.loadWorker()
    this.whiteTexture = createWhiteTexture(this.scene)
  }

  async initialize() {
    // No message listener needed with Comlink - direct method calls
  }

  async generate(parcel: Parcel, callback: (opaque: BABYLON.Mesh, glass: BABYLON.Mesh) => void, texture: BABYLON.Texture) {
    const vMesh = this.getVoxelMesh(parcel, texture)
    const gMesh = this.getGlassMesh(parcel)
    await Promise.all([vMesh, gMesh]).then(([mesh, glass]) => callback(mesh, glass))
  }

  private async getVoxelMesh(parcel: Parcel, texture: BABYLON.Texture): Promise<BABYLON.Mesh> {
    const result = await this.run('mesh', parcel)
    const { positions, indices, normals, uvs, uv2, faceMaterials } = result.mesh

    const mesh = new BABYLON.Mesh(`voxelizer/opaque-${parcel.id}`, this.scene)
    // while we are generating we don't want these to show up in game somewhere, let the callback enable them
    mesh.setEnabled(false)

    // it's possible to build a parcel without any opaque tiles
    if (positions.length === 0 || indices.length === 0) {
      return mesh
    }

    this.setLightBakedMaterial(parcel, mesh, texture)

    const d = new BABYLON.VertexData()
    d.positions = positions
    d.indices = asNarrowestUintType(indices, positions)
    d.normals = normals
    if (uvs) d.uvs = uvs
    if (uv2) d.uvs2 = uv2
    d.applyToMesh(mesh)

    if (faceMaterials) mesh.setVerticesData('block', new Float32Array(faceMaterials), false, 1)

    return mesh
  }

  private setLightBakedMaterial(parcel: Parcel, mesh: BABYLON.Mesh, texture: BABYLON.Texture) {
    // need uniforms for brightness, ambient, lightDirection, fogDensity, fogColor
    const mtrl = createLightmapMaterial(this.scene, `parcel_${parcel.id}`)
    mtrl.blockDirtyMechanism = false
    this.scene.environment?.setShaderParameters(mtrl)
    // set default white textures until things are fetched
    mtrl.setTexture('lightMap', this.whiteTexture)
    mtrl.setTexture('tileMap', this.whiteTexture)

    const customTileset = parcel.tileset

    if (customTileset) {
      const src = process.env.IMG_HOST + '/' + customTileset.slice(1)
      // invertY must match the unbaked path (voxel-field.ts setVoxelMaterial).
      // Mismatching it flips the atlas vertically, which makes the shader sample
      // the wrong tile row (e.g. grid -> blob) after baking.
      const tilemap = new BABYLON.Texture(src, this.scene, false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE, () => {
        mtrl.setTexture('tileMap', tilemap)
      })
    } else {
      mtrl.setTexture('tileMap', this.mesher.defaultTileset)
    }

    mtrl.setTexture('lightMap', texture)

    if (parcel.paletteColors && parcel.paletteColors[1]) {
      mtrl.setColor3Array('palette', parcel.paletteColors)
    } else {
      mtrl.setColor3Array(
        'palette',
        defaultColors.map((c) => BABYLON.Color3.FromHexString(c)),
      )
    }
    mtrl.blockDirtyMechanism = true

    mesh.material = mtrl
  }

  private async getGlassMesh(parcel: Parcel): Promise<BABYLON.Mesh> {
    const result = await this.run('glass', parcel)
    const { positions, indices, normals, uvs } = result.glass
    const scene = parcel.scene

    const mesh = new BABYLON.Mesh(`voxelizer/glass-${parcel.id}`, scene)
    // while we are generating we don't want these to show up in game somewhere, let the callback enable them
    mesh.setEnabled(false)

    // it's possible to build a parcel without any glass
    if (positions.length === 0 || indices.length === 0) {
      return mesh
    }

    const d = new BABYLON.VertexData()
    d.positions = positions
    d.indices = asNarrowestUintType(indices, positions)
    d.normals = normals
    if (uvs) d.uvs = uvs
    d.applyToMesh(mesh)

    mesh.material = createGlassMaterial(this.scene, {})

    return mesh
  }

  private async run<t extends BakedVoxelizerJobType>(type: t, parcel: Parcel): Promise<{ job: number } & { [k in t]: BakedVoxelizedMesh }> {
    let worker: BakedVoxelizerWorkerAPI

    if (this.workerAPI) {
      worker = this.workerAPI
    } else if (this.workerPromise) {
      worker = await this.workerPromise
    } else {
      throw new Error('No baked voxelizer worker or worker promise available')
    }

    const job = this.jobId++

    // only partial clone
    const clonedParcel: ParcelVoxels = {
      fieldShape: getFieldShape(parcel),
      /* hotfix - disable sending field as this breaks things see https://github.com/cryptovoxels/cryptovoxels/issues/709
                 this is only sent when you can edit the parcel, for all others it is generated in worker anyway
                 We update parcel.voxels each time a change is made so this should work fine
                 not sure why this is necessary, but it fixes things SO THERE! */

      // field: parcel.field,
      voxels: parcel.voxels,
      island: parcel.island,
    }

    const result = await worker.processJob(job, type, clonedParcel)

    if ('error' in result) {
      throw new Error(result.error)
    }

    if (!(type in result)) {
      throw new Error(`Invalid job type expected ${type} for job ${result.job}`)
    }

    return result as Record<BakedVoxelizerJobType, BakedVoxelizedMesh> & { job: number }
  }

  private loadWorker(): void {
    this.workerPromise = createComlinkWorker<BakedVoxelizerWorkerAPI>(
      // Webpack 5 recognizes this exact pattern and automatically compiles TypeScript workers to separate bundles
      () => new Worker(new URL('./baked-voxelizer-worker.ts', import.meta.url)),
      () => import('./baked-voxelizer-worker').then(({ bakedVoxelizerWorker }) => bakedVoxelizerWorker),
      { debug: true, workerName: 'baked-voxelizer-worker' },
    )
      .then(({ worker, cleanup }) => {
        this.workerAPI = worker
        this.workerCleanup = cleanup
        return worker
      })
      .catch((error) => {
        console.error('Failed to load baked voxelizer worker:', error)
        this.workerAPI = null
        throw error
      })
  }
}

const asNarrowestUintType = (indices: number[], positions: number[]): Uint16Array | Uint32Array => {
  return positions.length > 65535 * 3 ? new Uint32Array(indices) : new Uint16Array(indices)
}
