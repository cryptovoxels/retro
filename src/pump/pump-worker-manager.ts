import { FeatureRecord, SortableFeature, WorkerTiming, WorkerOperationType, InstanceRelation, LoadOrderItem, InstanceRelationMap, ParcelInstanceRelations } from './types'
import { getGridMono } from '../mono-pool'
import type { Mono } from '../mono'

interface WorkerStats {
  pendingRequests: number
  completedRequests: number
  failedRequests: number
  consecutiveTimeouts: number
  isHealthy: boolean
}

export class PumpWorkerManager {
  private workerAPI: Mono | null = null
  private workerCleanup: (() => void) | null = null
  private workerPromise: Promise<Mono> | null = null
  private isWorker = false
  private consecutiveTimeouts = 0
  private lastDetectionTiming: WorkerTiming | null = null
  private lastSortingTiming: WorkerTiming | null = null
  private workerState: 'idle' | 'busy' = 'idle'
  private detectionTimingHistory: WorkerTiming[] = []
  private sortingTimingHistory: WorkerTiming[] = []

  private _stats = {
    pendingRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    detectionResponseTimes: [] as number[],
    sortingResponseTimes: [] as number[],
    consecutiveTimeouts: 0,
    isHealthy: true,
  }

  constructor() {
    this.loadWorker()
  }

  getDetectionTimingHistory(): WorkerTiming[] {
    return this.detectionTimingHistory
  }

  getSortingTimingHistory(): WorkerTiming[] {
    return this.sortingTimingHistory
  }

  getLastDetectionTiming(): WorkerTiming | null {
    return this.lastDetectionTiming
  }

  getLastSortingTiming(): WorkerTiming | null {
    return this.lastSortingTiming
  }

  getWorkerStats(): WorkerStats {
    return {
      ...this._stats,
      consecutiveTimeouts: this.consecutiveTimeouts,
      isHealthy: this.consecutiveTimeouts < 3 && this.workerAPI !== null, // Max timeouts before marking unhealthy
    }
  }

  getWorkerState(): 'idle' | 'busy' {
    return this.workerState
  }

  private serializeCameraVectors(position: BABYLON.Vector3, direction: BABYLON.Vector3): { position: [number, number, number]; direction: [number, number, number] } {
    return {
      position: [position.x, position.y, position.z],
      direction: [direction.x, direction.y, direction.z],
    }
  }

  private serializeInstanceRelations(instanceRelations: ParcelInstanceRelations): InstanceRelation[] {
    const instanceRelationsArray: InstanceRelation[] = []
    for (const parcelRelations of instanceRelations.values()) {
      for (const [instanceUuid, baseUuid] of parcelRelations) {
        instanceRelationsArray.push([instanceUuid, baseUuid])
      }
    }
    return instanceRelationsArray
  }

  private recordResponseTime(responseTime: number, operationType: WorkerOperationType): void {
    const array = operationType === 'detection' ? this._stats.detectionResponseTimes : this._stats.sortingResponseTimes
    array.push(responseTime)
    if (array.length > 100) {
      // Keep last 100 samples for rolling statistics
      array.shift()
    }
  }

  getDetectionResponseTimes(): number[] {
    return this._stats.detectionResponseTimes
  }

  getSortingResponseTimes(): number[] {
    return this._stats.sortingResponseTimes
  }

  private executeWorkerRequest<T>(operation: () => Promise<T>, operationType: WorkerOperationType): Promise<T> {
    this.workerState = 'busy'
    this._stats.pendingRequests++
    const startTime = performance.now()

    const getWorker = () => {
      if (this.workerAPI) {
        return Promise.resolve(this.workerAPI)
      } else if (this.workerPromise) {
        return this.workerPromise
      } else {
        return Promise.reject(new Error('No pump worker or worker promise available'))
      }
    }

    return getWorker()
      .then((worker) => {
        return operation()
          .then((result) => {
            this.resetErrorTracking()
            this.updateSuccessStats()
            this.recordResponseTime(performance.now() - startTime, operationType)
            return result
          })
          .catch((error) => {
            this.handleRequestError()
            throw error
          })
      })
      .catch((error) => {
        this._stats.pendingRequests--
        this.workerState = 'idle'
        throw error
      })
  }

  private resetErrorTracking(): void {
    this.consecutiveTimeouts = 0
    this._stats.consecutiveTimeouts = 0
  }

  private updateSuccessStats(): void {
    this._stats.completedRequests++
    this._stats.pendingRequests--
    this.workerState = 'idle'
  }

  private handleRequestError(): void {
    this.consecutiveTimeouts++
    this._stats.consecutiveTimeouts = this.consecutiveTimeouts
    this._stats.failedRequests++
    this._stats.pendingRequests--
    this.workerState = 'idle'

    if (this.consecutiveTimeouts >= 3) {
      console.warn(`PumpWorkerManager: ${this.consecutiveTimeouts} consecutive timeouts, worker may be unresponsive`)
      this._stats.isHealthy = false
    }
  }

  requestInstanceIdentification(features: FeatureRecord[]): Promise<InstanceRelationMap> {
    return this.executeWorkerRequest(() => this.workerAPI!.requestInstanceIdentification(features), 'detection')
  }

  async requestFeatureSortingWithVectors(
    features: SortableFeature[],
    instanceRelations: ParcelInstanceRelations,
    cameraPosition: BABYLON.Vector3,
    cameraDirection: BABYLON.Vector3,
    maxDrawDistance = 200,
    currentParcelId?: number,
  ): Promise<LoadOrderItem[]> {
    const camera = this.serializeCameraVectors(cameraPosition, cameraDirection)
    const relations = this.serializeInstanceRelations(instanceRelations)
    return this.requestFeatureSorting(features, relations, camera.position, camera.direction, maxDrawDistance, currentParcelId)
  }

  requestFeatureSorting(
    features: SortableFeature[],
    instanceRelations: InstanceRelation[],
    cameraPosition: [number, number, number],
    cameraDirection: [number, number, number],
    maxDrawDistance = 200,
    currentParcelId?: number,
  ): Promise<LoadOrderItem[]> {
    return this.executeWorkerRequest(() => this.workerAPI!.requestFeatureSorting(features, instanceRelations, cameraPosition, cameraDirection, maxDrawDistance, currentParcelId), 'sorting')
  }

  private loadWorker(): void {
    this.workerPromise = getGridMono()
      .then(({ worker, cleanup, isWorker }) => {
        this.workerAPI = worker
        this.workerCleanup = cleanup
        this.isWorker = isWorker
        return worker
      })
      .catch((error) => {
        console.error('Failed to load pump worker:', error)
        this.workerAPI = null
        throw error
      })
  }
}
