import type { VoxData } from './vox-reader'
import { getComputePool } from '../../src/mono-pool'
import type { Mono } from '../../src/mono'
import {
  Mesh,
  SceneContext,
  StandardMaterialProps,
  createMeshFromData,
  createStandardMaterial,
} from '@babylonjs/lite'

type JobRecordCommon = {
  wantCollider: boolean
  renderJob: number
  flipX: boolean
  megavox: boolean
  sizeHint?: Array<number>
  timeoutMs: number
  colorMap?: Record<number, [number, number, number]>
}

type UrlJobRecord = JobRecordCommon & {
  url: string
}

type BufferJobRecord = JobRecordCommon & {
  buffer: ArrayBuffer
}

export type JobRecord = UrlJobRecord | BufferJobRecord

type JobsManager = { [x: number]: (data: { renderJob: number } & (VoxData | { error: any })) => void }

export interface Options {
  wantCollider?: boolean
  invertX?: boolean
  megavox?: boolean
  sizeHint?: { toArray?: (out: number[]) => void } | number[]
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

function meshNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3
    const ib = indices[i + 1] * 3
    const ic = indices[i + 2] * 3
    const ax = positions[ia]
    const ay = positions[ia + 1]
    const az = positions[ia + 2]
    const bx = positions[ib] - ax
    const by = positions[ib + 1] - ay
    const bz = positions[ib + 2] - az
    const cx = positions[ic] - ax
    const cy = positions[ic + 1] - ay
    const cz = positions[ic + 2] - az
    const nx = by * cz - bz * cy
    const ny = bz * cx - bx * cz
    const nz = bx * cy - by * cx
    normals[ia] += nx
    normals[ia + 1] += ny
    normals[ia + 2] += nz
    normals[ib] += nx
    normals[ib + 1] += ny
    normals[ib + 2] += nz
    normals[ic] += nx
    normals[ic + 1] += ny
    normals[ic + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= len
    normals[i + 1] /= len
    normals[i + 2] /= len
  }
  return normals
}

function voxMaterial(): StandardMaterialProps {
  const m = createStandardMaterial()
  m.diffuseColor = [1, 1, 1]
  m.specularColor = [0.1, 0.1, 0.1]
  m.specularPower = 16
  return m
}

export class VoxImporter {
  private static readonly JOB_TIMEOUT_MS = 5000

  private jobs: JobsManager = {}
  private jobWorkerMap: Map<number, Mono> = new Map()
  private workerBusyCount: Map<Mono, number> = new Map()
  private jobIndex = 0
  private material: StandardMaterialProps | null = null
  private workers: Mono[] = []
  private workerCleanups: (() => void)[] = []
  private workersReady: Promise<void> | null = null
  private _scene: SceneContext | undefined

  initialize(scene: SceneContext) {
    if (scene) this._scene = scene

    /// #if RUNTIME === 'WEB'
    if (!this.workersReady) {
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
    }
    /// #endif

    if (!scene || this.material) return
    this.material = voxMaterial()
  }

  import(urlOrBuffer: string | ArrayBuffer, options: Options): Promise<Mesh> {
    return new Promise((resolve, reject) => {
      const scene = this._scene ?? window.scene
      if (!this.material) {
        console.error('VoxImport.material missing')
      }
      if (options.signal?.aborted) {
        return reject('Aborted')
      }

      const renderJob = Number(this.jobIndex)
      this.jobIndex++

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          this.cancelJob(renderJob)
          return reject(new Error('Aborted'))
        })
      }

      this.jobs[renderJob] = (data) => {
        this.cleanupJob(renderJob)

        if ('error' in data) {
          return reject(data.error)
        }

        if (options.signal?.aborted) {
          return reject(new Error('Aborted'))
        }

        const { positions, indices, colors } = data as VoxData
        const idx = indices instanceof Uint32Array ? indices : new Uint32Array(indices)
        const normals = meshNormals(positions, idx)
        const mesh = createMeshFromData(scene.surface.engine, 'utils/vox-box', positions, normals, idx, undefined, undefined, undefined, colors)
        mesh.material = this.material!
        mesh.pickable = true
        resolve(mesh)
      }

      const sizeHint = [1, 1, 1]
      if (options?.sizeHint) {
        const hint = options.sizeHint as any
        if (typeof hint.toArray === 'function') {
          hint.toArray(sizeHint)
        } else if (Array.isArray(hint)) {
          sizeHint[0] = hint[0] ?? 1
          sizeHint[1] = hint[1] ?? 1
          sizeHint[2] = hint[2] ?? 1
        }
      }

      const voxJob: JobRecord = {
        renderJob,
        ...(urlOrBuffer instanceof ArrayBuffer ? { buffer: urlOrBuffer } : { url: urlOrBuffer }),
        flipX: options && 'invertX' in options ? !!options.invertX : true,
        megavox: options && !!options.megavox,
        sizeHint,
        wantCollider: false,
        timeoutMs: VoxImporter.JOB_TIMEOUT_MS,
        colorMap: options.colorMap,
      }
      /// #if RUNTIME === 'WEB'
      const run = async () => {
        if (this.workersReady) await this.workersReady
        if (this.workers.length === 0) {
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

    for (const worker of this.workers) {
      if (!this.workerBusyCount.has(worker)) {
        this.workerBusyCount.set(worker, 0)
      }
    }

    let leastBusyWorker = this.workers[0]
    let minJobs = this.workerBusyCount.get(leastBusyWorker) || 0

    for (const worker of this.workers) {
      const busyCount = this.workerBusyCount.get(worker) || 0
      if (busyCount < minJobs) {
        minJobs = busyCount
        leastBusyWorker = worker
      }
    }

    this.workerBusyCount.set(leastBusyWorker, minJobs + 1)
    return leastBusyWorker
  }

  private cleanupJob(renderJob: number) {
    const worker = this.jobWorkerMap.get(renderJob)
    if (worker && this.workerBusyCount.has(worker)) {
      const currentCount = this.workerBusyCount.get(worker) || 0
      this.workerBusyCount.set(worker, Math.max(0, currentCount - 1))
    }

    this.jobWorkerMap.delete(renderJob)
    delete this.jobs[renderJob]
  }

  private cancelJob(renderJob: number) {
    const worker = this.jobWorkerMap.get(renderJob)
    if (worker) {
      worker.cancelJob(renderJob)
    }
    this.cleanupJob(renderJob)
  }

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
    for (const renderJob of Object.keys(this.jobs)) {
      this.cancelJob(Number(renderJob))
    }

    this.jobs = {}
    this.jobWorkerMap.clear()
    this.workerBusyCount.clear()

    this.workerCleanups.forEach((cleanup) => cleanup())
    this.workers = []
    this.workerCleanups = []
  }
}
