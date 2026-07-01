import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import type { NdArray } from 'ndarray'
import type { ApiParcelMessage } from '../common/messages/api-parcels'
import { GridWorkerParcelRecord } from '../common/messages/grid'
import { isCompleteParcelRecord } from '../common/messages/parcel'
import { getBufferFromVoxels, getFieldShape } from '../common/voxels/helpers'
import type { FetchOptions } from '../web/src/utils'
import type { GridWorkerOutput } from './monoworker/grid'
import { aabbDistance, vec3, type Vec3 } from './monoworker/math'
// Removed meshing imports - meshing now handled on main thread

// Create a retry policy that'll try whatever function with a randomized exponential backoff.
// to be used by fetch!
const retryPolicy = retry(handleAll, { backoff: new ExponentialBackoff() })

export enum LoadState {
  None,
  Loading,
  Loaded,
  Error,
}

interface GridWorkerInterface {
  readonly self: { postMessage(message: GridWorkerOutput, transfer?: Transferable[]): void }
  readonly parcelGenerationQueue: Set<number>
  handleParcelGenerated(parcelId: number): void
}

export class GridWorkerParcel {
  description: GridWorkerParcelRecord
  loadState = LoadState.None
  loadAbortController: AbortController | undefined

  constructor(
    private grid: GridWorkerInterface,
    desc: GridWorkerParcelRecord,
  ) {
    this.description = desc
  }

  public get id() {
    return this.description.id
  }

  public get hash() {
    return this.description.hash
  }

  public get min() {
    return vec3(this.description.x1, this.description.y1, this.description.z1)
  }

  public get max() {
    return vec3(this.description.x2, this.description.y2, this.description.z2)
  }

  public async load(): Promise<void> {
    if (this.loadState === LoadState.Loading || this.loadState === LoadState.Loaded) {
      console.info(`[grid-worker] Parcel ${this.id} already loaded or loading`)
      return
    }

    // Fetch data if needed
    if (!isCompleteParcelRecord(this.description)) {
      this.loadState = LoadState.Loading
      const success = await this.fetchParcelData()
      if (!success) {
        this.loadState = LoadState.Error
        return
      }
    }

    // Verify we have complete data and send to main thread
    if (!isCompleteParcelRecord(this.description)) {
      console.info('[grid-worker] Attemping to send grid-worker Loaded message without complete data')
      this.loadState = LoadState.Error
      return
    }

    this.loadState = LoadState.Loaded

    // Pre-compute the field buffer in the worker to offload main thread
    let fieldBuffer: NdArray<Uint16Array> | undefined
    try {
      // Create a VoxelObject with fieldShape for getBufferFromVoxels
      const voxelObject = { ...this.description, fieldShape: getFieldShape(this.description) }
      fieldBuffer = getBufferFromVoxels(voxelObject)
    } catch (error) {
      console.warn(`[grid-worker] Failed to pre-compute field for parcel ${this.id}:`, error)
      fieldBuffer = undefined
    }

    // Track that we're sending this parcel for generation on main thread
    this.grid.parcelGenerationQueue.add(this.id)

    // Send parcel data with pre-computed field buffer
    this.postWorkerMessage({
      type: 'Loaded',
      parcelId: this.id,
      description: this.description,
      fieldBuffer: fieldBuffer,
    })
  }

  public unload() {
    const wasLoaded = this.loadState === LoadState.Loaded
    this.loadState = LoadState.None
    this.loadAbortController?.abort('ABORT:unloading parcel')
    if (wasLoaded) {
      this.postWorkerMessage({ type: 'Unloaded', parcelId: this.id })
    }
  }

  public getDistance(p: Vec3) {
    return aabbDistance(p, this.min, this.max)
  }

  private async fetchParcelData(): Promise<boolean> {
    const url = `/grid/parcels/${this.id}`

    const abortController = new AbortController()
    this.loadAbortController = abortController

    try {
      const res = await this.fetchJson(url, abortController.signal)
      const response = (await res.json()) as ApiParcelMessage
      return this.handleFetchSuccess(response)
    } catch {
      if (abortController.signal.aborted) return false
      const fallbackResult = await retryPolicy
        .execute(async () => {
          const res = await this.fetchJson(url, abortController.signal)
          const response = (await res.json()) as ApiParcelMessage
          return this.handleFetchSuccess(response)
        }, abortController.signal)
        .catch(() => null)
      return fallbackResult !== null ? fallbackResult : false
    }
  }

  private handleFetchSuccess(response: ApiParcelMessage): boolean {
    this.loadAbortController = undefined
    if (!response.success) {
      return false
    }
    Object.assign(this.description, response.parcel)
    return true
  }

  private async fetchJson(url: string, signal?: AbortSignal) {
    const opts: FetchOptions = { method: 'get', signal, priority: 'high', cache: 'no-store' }
    const req = await fetch(url, opts)
    if (!req.ok) throw new Error(req.statusText)
    return req
  }

  private postWorkerMessage(message: GridWorkerOutput, transfer: Transferable[] = []) {
    this.grid.self.postMessage(message, transfer)
  }
}
