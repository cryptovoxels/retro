import { runCompute } from '../../src/mono-pool'
import { unpackVoxelbr } from './voxelbr'

export interface Options {
  megavox?: boolean
  sizeHint?: BABYLON.Vector3
  signal: AbortSignal
  colorMap?: Record<number, [number, number, number]>
}

export const VOX_SCALE = 0.02

let _instance: VoxImporter | null = null
export const voxImporter = (): VoxImporter => {
  if (!_instance) {
    _instance = new VoxImporter()
  }
  _instance.initialize(window.scene)
  return _instance
}

function applyBuffers(mesh: BABYLON.Mesh, engine: BABYLON.AbstractEngine, positions: Int8Array, colors: Uint8Array, indices: Uint16Array | Uint32Array) {
  mesh.setVerticesBuffer(
    new BABYLON.VertexBuffer(engine, positions, BABYLON.VertexBuffer.PositionKind, {
      updatable: false,
      size: 3,
      type: BABYLON.VertexBuffer.BYTE,
      normalized: false,
    }),
  )
  mesh.setVerticesBuffer(
    new BABYLON.VertexBuffer(engine, colors, BABYLON.VertexBuffer.ColorKind, {
      updatable: false,
      size: 4,
      type: BABYLON.VertexBuffer.UNSIGNED_BYTE,
      normalized: true,
    }),
  )
  mesh.setIndices(indices)
  // Scale int8 voxel units to world without touching mesh.scaling (feature/attachment scale stays clean)
  mesh.setPreTransformMatrix(BABYLON.Matrix.Scaling(VOX_SCALE, VOX_SCALE, VOX_SCALE))
  mesh.refreshBoundingInfo()
}

export class VoxImporter {
  private static readonly JOB_TIMEOUT_MS = 5000

  // private material: BABYLON.Material | null = null
  private _scene: BABYLON.Scene | undefined

  initialize(scene: BABYLON.Scene) {
    if (scene) this._scene = scene
    // if (!scene || this.material) return

    // const mat = new BABYLON.StandardMaterial('vox-model/vox-shader', scene)
    // mat.fogEnabled = true
    // mat.specularColor.set(0, 0, 0)
    // this.material = mat
  }

  private makeMesh(scene: BABYLON.Scene) {
    const mesh = new BABYLON.Mesh('utils/vox-box', scene)
    const mat = new BABYLON.StandardMaterial('vox-model/vox-shader', scene)
    mat.specularColor.set(0, 0, 0)
    mesh.material = mat
    mesh.useVertexColors = true
    mesh.isPickable = true
    return mesh
  }

  // pre-meshed .voxelbr: slice typed views and upload, no worker
  async importBin(buf: ArrayBuffer, signal?: AbortSignal): Promise<BABYLON.Mesh> {
    if (signal?.aborted) throw new Error('Aborted')
    const scene = this._scene ?? window.scene
    const mesh = this.makeMesh(scene)
    try {
      const { positions, colors, indices } = unpackVoxelbr(buf)
      if (signal?.aborted) {
        mesh.dispose()
        throw new Error('Aborted')
      }
      applyBuffers(mesh, scene.getEngine(), positions, colors, indices)
      return mesh
    } catch (e) {
      mesh.dispose()
      throw e
    }
  }

  async import(urlOrBuffer: string | ArrayBuffer, options: Options): Promise<BABYLON.Mesh> {
    // if (!this.material) {
    //   console.error('VoxImport.material missing')
    // }
    if (options.signal?.aborted) {
      throw new Error('Aborted')
    }

    const scene = this._scene ?? window.scene
    const mesh = this.makeMesh(scene)

    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        mesh.dispose()
        reject(new Error('Aborted'))
      }
      options.signal.addEventListener('abort', onAbort)
    })

    try {
      /// #if RUNTIME === 'WEB'
      const data = await Promise.race([
        runCompute((w) =>
          w.loadVox(
            {
              ...(urlOrBuffer instanceof ArrayBuffer ? { buffer: urlOrBuffer } : { url: urlOrBuffer }),
              megavox: !!options.megavox,
              timeoutMs: VoxImporter.JOB_TIMEOUT_MS,
              colorMap: options.colorMap,
            },
            options.signal,
          ),
        ),
        aborted,
      ])

      if (data?.cancelled || options.signal.aborted) {
        mesh.dispose()
        throw new Error('Aborted')
      }

      applyBuffers(mesh, scene.getEngine(), data.positions, data.colors, data.indices)

      return mesh
      /// #endif
    } catch (error) {
      if (options.signal.aborted) {
        mesh.dispose()
        throw new Error('Aborted')
      }
      mesh.dispose()
      throw error
    } finally {
      if (onAbort) options.signal.removeEventListener('abort', onAbort)
    }
  }
}
