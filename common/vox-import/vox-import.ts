import VoxVertexShader from './vox.vsh'
import VoxPixelShader from './vox.fsh'
import type { VoxData } from './vox-reader'
import { getComputePool } from '../../src/mono-pool'
import type { Mono } from '../../src/mono'

BABYLON.Effect.ShadersStore['VoxVertexShader'] = VoxVertexShader
BABYLON.Effect.ShadersStore['VoxPixelShader'] = VoxPixelShader

type JobRecordCommon = {
  wantCollider: boolean
  renderJob: number
  flipX: boolean
  megavox: boolean
  sizeHint?: Array<number>
  maxTriangles: number
  dryRun: boolean // true to just test against maxTriangles and avoid actually constructing the mesh as far as possible
  timeoutMs: number
}

type UrlJobRecord = JobRecordCommon & {
  url: string
}

type BufferJobRecord = JobRecordCommon & {
  buffer: ArrayBuffer
}

export type JobRecord = UrlJobRecord | BufferJobRecord

//TODO: Estimate these better. Architect Island has megavoxes with > 500000!
export const MAX_TRIANGLES_PER_VOX_MODEL_DISPLAY = 1000000
export const MAX_TRIANGLES_PER_VOX_MODEL_UPLOAD = 150000

type JobsManager = { [x: number]: (data: { renderJob: number } & (VoxData | { error: any })) => void }

export interface Options {
  wantCollider?: boolean // default false
  invertX?: boolean // default false
  megavox?: boolean
  sizeHint?: BABYLON.Vector3
  signal: AbortSignal
  maxTriangles?: number
  dryRun?: boolean // true to just test against maxTriangles and avoid actually constructing the mesh as far as possible
}

let _instance: VoxImporter | null = null
export const voxImporter = (): VoxImporter => {
  if (!_instance) {
    _instance = new VoxImporter()
    _instance.initialize(window.scene)
  }
  return _instance
}

export class VoxImporter {
  private static readonly WORKER_COUNT = 4
  private static readonly JOB_TIMEOUT_MS = 5000

  private jobs: JobsManager = {}
  private jobWorkerMap: Map<number, Mono> = new Map()
  private workerBusyCount: Map<Mono, number> = new Map()
  private jobIndex = 0
  private material: BABYLON.Material | null = null
  private workers: Mono[] = []
  private workerCleanups: (() => void)[] = []
  private workersReady: Promise<void> | null = null
  private _scene: BABYLON.Scene | undefined

  initialize(scene: BABYLON.Scene) {
    this._scene = scene
    this.material = new BABYLON.ShaderMaterial(
      'vox-model/vox-shader',
      scene,
      { vertex: 'Vox', fragment: 'Vox' },
      {
        attributes: ['position', 'color'],
        uniforms: ['world', 'worldViewProjection', 'view', 'projection', 'cameraPosition', 'brightness', 'ambient', 'lightDirection', 'fogColor', 'fogDensity'],
        defines: ['#define IMAGEPROCESSINGPOSTPROCESS'],
      },
    )

    const env = window.environment
    if (env && this.material instanceof BABYLON.ShaderMaterial) {
      this.material.setVector3('vLight', env.sunPosition || new BABYLON.Vector3(0.577, 0.577, -0.577).normalize())
      env.setShaderParameters(this.material, 1.8)
    }
    this.material.blockDirtyMechanism = true

    // Triple slash comment with #if is for the ifdef-loader plugin: https://www.npmjs.com/package/ifdef-loader
    // so that we can conditionally bundle code. We don't want the server spinning up this web workers.
    /// #if RUNTIME === 'WEB'
    this.workersReady = getComputePool()
      .then((handles) => {
        for (const h of handles) {
          this.workers.push(h.worker)
          this.workerCleanups.push(h.cleanup)
          this.workerBusyCount.set(h.worker, 0)
        }
      })
      .catch((error) => {
        console.error('Failed to load vox workers:', error)
      })
    /// #endif
  }

  import(urlOrBuffer: string | ArrayBuffer, options: Options): Promise<BABYLON.Mesh> {
    return new Promise((resolve, reject) => {
      if (!this.material) {
        console.error('VoxImport.material missing')
      }
      if (options.signal?.aborted) {
        return reject('Aborted')
      }
      const mesh = new BABYLON.Mesh('utils/vox-box', this._scene ?? window.scene)
      mesh.material = this.material
      mesh.isPickable = true
      mesh.checkCollisions = false

      const renderJob = Number(this.jobIndex)
      this.jobIndex++

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          this.cancelJob(renderJob)
          mesh.dispose()
          return reject(new Error('Aborted'))
        })
      }

      this.jobs[renderJob] = (data) => {
        this.cleanupJob(renderJob)

        if ('error' in data) {
          mesh.dispose()
          return reject(data.error)
        }

        if (options.signal?.aborted) {
          mesh.dispose()
          return reject(new Error('Aborted'))
        }

        const { positions, indices, colors } = data as VoxData

        const d = new BABYLON.VertexData()
        d.positions = positions
        d.indices = indices
        d.colors = colors
        d.applyToMesh(mesh)

        mesh.checkCollisions = false
        mesh.refreshBoundingInfo()

        resolve(mesh)
      }

      const sizeHint = [1, 1, 1]

      if (options && 'sizeHint' in options) {
        options.sizeHint?.toArray(sizeHint)
      }

      const voxJob: JobRecord = {
        renderJob,
        ...(urlOrBuffer instanceof ArrayBuffer ? { buffer: urlOrBuffer } : { url: urlOrBuffer }),
        flipX: options && 'invertX' in options ? !!options.invertX : true,
        megavox: options && !!options.megavox,
        sizeHint,
        maxTriangles: options.maxTriangles ?? MAX_TRIANGLES_PER_VOX_MODEL_DISPLAY,
        dryRun: options.dryRun ?? false,
        wantCollider: false,
        timeoutMs: VoxImporter.JOB_TIMEOUT_MS,
      }
      /// #if RUNTIME === 'WEB'
      const run = async () => {
        if (this.workersReady) await this.workersReady
        if (this.workers.length === 0) {
          mesh.dispose()
          return reject(new Error('No workers available'))
        }
        const worker = this.getFreeWorker()
        this.jobWorkerMap.set(renderJob, worker)
        worker
          .loadVox(voxJob)
          .then((result) => {
            const voxImport = this.jobs[renderJob]
            if (voxImport) {
              if ('cancelled' in result && result.cancelled) {
                this.cleanupJob(renderJob)
                return
              }
              voxImport(result)
            }
          })
          .catch((error) => {
            const voxImport = this.jobs[renderJob]
            if (voxImport) {
              voxImport({ renderJob, error: error.message || error })
            } else {
              throw error
            }
          })
      }
      run().catch(reject)
      /// #endif
    })
  }

  private getFreeWorker(): Mono {
    if (this.workers.length === 0) {
      console.error('no workers for VoxImporter')
      throw new Error('No workers available')
    }

    // Initialize busy counts for new workers
    for (const worker of this.workers) {
      if (!this.workerBusyCount.has(worker)) {
        this.workerBusyCount.set(worker, 0)
      }
    }

    // Find worker with least active jobs
    let leastBusyWorker = this.workers[0]
    let minJobs = this.workerBusyCount.get(leastBusyWorker) || 0

    for (const worker of this.workers) {
      const busyCount = this.workerBusyCount.get(worker) || 0
      if (busyCount < minJobs) {
        minJobs = busyCount
        leastBusyWorker = worker
      }
    }

    // Increment busy count
    this.workerBusyCount.set(leastBusyWorker, minJobs + 1)
    return leastBusyWorker
  }

  private cleanupJob(renderJob: number) {
    // Decrement worker busy count
    const worker = this.jobWorkerMap.get(renderJob)
    if (worker && this.workerBusyCount.has(worker)) {
      const currentCount = this.workerBusyCount.get(worker) || 0
      this.workerBusyCount.set(worker, Math.max(0, currentCount - 1))
    }

    // Remove worker mapping and job
    this.jobWorkerMap.delete(renderJob)
    delete this.jobs[renderJob]
  }

  private cancelJob(renderJob: number) {
    // Send cancellation message to the worker handling this job
    const worker = this.jobWorkerMap.get(renderJob)
    if (worker) {
      worker.cancelJob(renderJob)
    }
    this.cleanupJob(renderJob)
  }

  /**
   * Get current worker load statistics for debugging
   */
  public getWorkerStats() {
    const stats = this.workers.map((worker, index) => ({
      workerIndex: index,
      busyJobs: this.workerBusyCount.get(worker) || 0,
    }))

    return {
      totalWorkers: this.workers.length,
      totalActiveJobs: Object.keys(this.jobs).length,
      workerLoads: stats,
    }
  }

  public terminate() {
    // Cancel all pending jobs
    for (const renderJob of Object.keys(this.jobs)) {
      this.cancelJob(Number(renderJob))
    }

    // Clear all maps
    this.jobs = {}
    this.jobWorkerMap.clear()
    this.workerBusyCount.clear()

    // Terminate workers
    this.workerCleanups.forEach((cleanup) => cleanup())
    this.workers = []
    this.workerCleanups = []
  }
}
