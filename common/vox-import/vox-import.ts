import { runCompute } from '../../src/mono-pool'

export interface Options {
  invertX?: boolean // default false -> flipX true when absent
  megavox?: boolean
  sizeHint?: BABYLON.Vector3
  signal: AbortSignal
  colorMap?: Record<number, [number, number, number]>
}

let _instance: VoxImporter | null = null
export const voxImporter = (): VoxImporter => {
  if (!_instance) {
    _instance = new VoxImporter()
  }
  _instance.initialize(window.scene)
  return _instance
}

export class VoxImporter {
  private static readonly JOB_TIMEOUT_MS = 5000

  private material: BABYLON.Material | null = null
  private _scene: BABYLON.Scene | undefined

  initialize(scene: BABYLON.Scene) {
    if (scene) this._scene = scene
    if (!scene || this.material) return

    const mat = new BABYLON.StandardMaterial('vox-model/vox-shader', scene)
    mat.fogEnabled = true
    mat.specularColor.set(0, 0, 0)
    mat.backFaceCulling = false
    mat.freeze()
    mat.blockDirtyMechanism = true
    this.material = mat
  }

  async import(urlOrBuffer: string | ArrayBuffer, options: Options): Promise<BABYLON.Mesh> {
    if (!this.material) {
      console.error('VoxImport.material missing')
    }
    if (options.signal?.aborted) {
      throw new Error('Aborted')
    }

    const mesh = new BABYLON.Mesh('utils/vox-box', this._scene ?? window.scene)
    mesh.material = this.material
    mesh.useVertexColors = true
    mesh.isPickable = true

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
              flipX: 'invertX' in options ? !!options.invertX : true,
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

      const d = new BABYLON.VertexData()
      d.positions = data.positions
      d.indices = data.indices
      d.colors = data.colors
      d.applyToMesh(mesh)
      mesh.refreshBoundingInfo()
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
