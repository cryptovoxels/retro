import type Feature from '../features/feature'
import type Parcel from '../parcel'
import { tidyVec3 } from '../utils/helpers'
import { PumpWorkerManager } from './pump-worker-manager'
import type { FeatureRecord, LoadItem, LoadOrderItem, ParcelInstanceRelations, SortableFeature, WorkerOperationType } from './types'

const DEFAULT_MAX_CONCURRENT_FEATURES = 20 // Default max concurrent features
const DEFAULT_TIMEOUT = 5000 // Default timeout in milliseconds

enum ParcelProcessingState {
  PENDING_INSTANCE_DETECTION = 'pending_instance_detection',
  INSTANCE_DETECTION_COMPLETE = 'instance_detection_complete',
  DISPOSING = 'disposing',
}

interface ConsolidatedParcelTracking {
  parcel: Parcel
  onDone: (parcel: Parcel) => void
  expectedFeatureCount: number
  completedFeatureCount: number
  loadingFeatureCount: number // Features currently being created
  erroredFeatureCount: number // Features that failed to create
  timedOutFeatureCount: number // Features that timed out
  features: FeatureRecord[]
  state: ParcelProcessingState
  loadingFeatures: Map<string, { startTime: number; abortController: AbortController }>
}

interface PendingDeactivation {
  parcel: Parcel
  features: Feature[]
  onDone: () => void
}

export class FeaturePump {
  private parcelStates = new Map<number, ConsolidatedParcelTracking>()

  private loadQueue: LoadItem[] = []

  private deactivationQueue: PendingDeactivation[] = []

  private cameraPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero()
  private cameraDirection: BABYLON.Vector3 = BABYLON.Vector3.Forward()
  private lastSortPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero()
  private lastSortDirection: BABYLON.Vector3 = BABYLON.Vector3.Forward()
  private currentParcel: Parcel | undefined = undefined
  private needsSorting = false

  private workerManager: PumpWorkerManager
  private maxConcurrentFeatures: number

  // Debug statistics
  private _stats = {
    lastSortTimestamp: 0,
    lastSortDuration: 0,
    totalSortsCompleted: 0,

    totalParcelsActivated: 0,
    totalParcelsDeactivated: 0,

    currentBusyOperations: '' as WorkerOperationType | '',
  }

  // Instance relations by parcel ID
  private instanceRelations: ParcelInstanceRelations = new Map()

  public constructor(
    private scene: BABYLON.Scene,
    workerManager?: PumpWorkerManager,
    maxConcurrentFeatures?: number,
  ) {
    this.workerManager = workerManager || new PumpWorkerManager()
    this.maxConcurrentFeatures = maxConcurrentFeatures ?? DEFAULT_MAX_CONCURRENT_FEATURES
  }

  get maxConcurrentFeaturesLimit(): number {
    return this.maxConcurrentFeatures
  }

  private transitionToState(parcelId: number, newState: ParcelProcessingState): boolean {
    const tracking = this.parcelStates.get(parcelId)
    if (!tracking) return false

    tracking.state = newState
    return true
  }

  private getParcelsByState(state: ParcelProcessingState): ConsolidatedParcelTracking[] {
    return Array.from(this.parcelStates.values()).filter((tracking) => tracking.state === state)
  }

  private atomicStateChange(parcelId: number, fromState: ParcelProcessingState, toState: ParcelProcessingState): boolean {
    const tracking = this.parcelStates.get(parcelId)
    if (!tracking || tracking.state !== fromState) return false

    tracking.state = toState
    return true
  }

  public activate(parcel: Parcel, features: FeatureRecord[], onDone: (parcel: Parcel) => void): void {
    this.parcelStates.set(parcel.id, {
      parcel: parcel,
      onDone: onDone,
      expectedFeatureCount: features.length,
      completedFeatureCount: 0,
      loadingFeatureCount: 0,
      erroredFeatureCount: 0,
      timedOutFeatureCount: 0,
      features: [...features],
      state: ParcelProcessingState.PENDING_INSTANCE_DETECTION,
      loadingFeatures: new Map(),
    })

    // Update debug counters
    this._stats.totalParcelsActivated++

    // Mark that a rebuild is needed on next pump cycle
    this.needsSorting = true
  }

  /**
   * Deactivates a parcel and its features.
   * Transitions parcel to DISPOSING state and queues features for disposal.
   *
   * @param parcel The parcel to deactivate
   * @param features Features to dispose
   * @param onDone Callback when deactivation is complete
   */
  public deactivate(parcel: Parcel, features: Feature[], onDone: () => void): void {
    // Transition parcel to DISPOSING state
    this.transitionToState(parcel.id, ParcelProcessingState.DISPOSING)

    // Queue for disposal processing
    this.deactivationQueue.push({ parcel, features, onDone })

    // Update debug counters
    this._stats.totalParcelsDeactivated++
  }

  /**
   * Main pump cycle that processes state-based operations in a safe, ordered manner:
   * 1. Clean up DISPOSING parcels first
   * 2. Try to start worker operations (mutually exclusive)
   * 3. Process feature creation from global load queue
   */
  public async pump(): Promise<void> {
    const oldBlock = this.scene.blockfreeActiveMeshesAndRenderingGroups
    if (this.deactivationQueue.length > 0 || this.loadQueue.length > 0) {
      this.scene.blockfreeActiveMeshesAndRenderingGroups = true
    }

    // Step 1: Process deactivations (clean up DISPOSING parcels)
    const hadDeactivations = this.handleDeactivations()

    // Step 2: Try to start worker operation (mutually exclusive)
    this.tryStartWorkerOperation()

    // Step 3: Process activations from global load queue (with throttling)
    if (!hadDeactivations) this.handleActivations()

    this.scene.blockfreeActiveMeshesAndRenderingGroups = oldBlock
  }

  /**
   * Updates camera position and direction for visual sorting.
   *
   * Sets needsSort flag for future feature activations when camera changes significantly.
   * Also re-sorts current visual queue if it contains features and camera changed.
   *
   * Significant changes:
   * - Position: moved more than 1.0 world units
   * - Direction: changed by more than ~8.1 degrees (dot product < 0.99)
   *
   * @param position Camera world position
   * @param direction Camera look direction (will be normalized internally if needed)
   */
  public setCameraPosition(position: BABYLON.Vector3, direction: BABYLON.Vector3): void {
    const directionChanged = this.calculateDirectionAlignment(this.lastSortDirection, direction) < 0.99
    const positionChanged = BABYLON.Vector3.Distance(position, this.lastSortPosition) > 1.0
    const cameraChanged = positionChanged || directionChanged

    this.cameraPosition.copyFrom(position)
    this.cameraDirection.copyFrom(direction)

    // Re-sort current visual queue if camera changed and queue has pending features
    if (this.loadQueue.length > 0 && cameraChanged) {
      this.needsSorting = true
    }
  }

  // Expose debug stats for PumpStatsReader - only accessed when debug UI needs it
  get stats() {
    const workerStats = this.workerManager.getWorkerStats()

    return {
      ...this._stats,
      // Include worker stats from manager
      failedWorkerRequests: workerStats.failedRequests,
      workerIsHealthy: workerStats.isHealthy,
      // Include pending feature count
      totalPendingFeatures: this.getTotalLoadingFeatureCount(),
    }
  }

  public setCurrentParcel(parcel: Parcel | undefined): void {
    this.currentParcel = parcel
  }

  // Legacy method for compatibility with grid.ts and parcel.ts
  public clearParcelTasksForID(parcelId: number): void {
    this.deactivationQueue = this.deactivationQueue.filter((deactivation) => deactivation.parcel.id !== parcelId)

    this.removeParcelFromQueues(parcelId)
    this.parcelStates.delete(parcelId)
    this.instanceRelations.delete(parcelId)
  }

  public dropFeature(parcelId: number, uuid: string): void {
    const tracking = this.parcelStates.get(parcelId)
    if (tracking) {
      tracking.features = tracking.features.filter((f) => f.uuid !== uuid)
      const loading = tracking.loadingFeatures.get(uuid)
      if (loading) {
        loading.abortController.abort('ABORT: feature deleted')
        tracking.loadingFeatures.delete(uuid)
        tracking.loadingFeatureCount = Math.max(0, tracking.loadingFeatureCount - 1)
      }
    }
    this.removeParcelFromQueues(parcelId)
  }

  private handleActivations(): void {
    if (this.loadQueue.length === 0) return

    let totalPendingFeatures = this.getTotalLoadingFeatureCount()

    if (totalPendingFeatures >= this.maxConcurrentFeatures) {
      this.checkAndTimeoutOldestFeature()
      totalPendingFeatures = this.getTotalLoadingFeatureCount()
    }

    if (totalPendingFeatures >= this.maxConcurrentFeatures) {
      return
    }

    const loadItem = this.loadQueue.shift()
    if (!loadItem) return

    if (Array.isArray(loadItem)) {
      this.processFeatureGroup(loadItem)
    } else {
      this.processFeature(loadItem)
    }
  }

  private checkAndTimeoutOldestFeature(): void {
    const now = performance.now()
    let oldestFeature: { uuid: string; startTime: number; abortController: AbortController; parcelId: number } | null = null

    // Find the oldest loading feature across all parcels
    for (const [parcelId, tracking] of this.parcelStates.entries()) {
      for (const [uuid, loadingInfo] of tracking.loadingFeatures.entries()) {
        if (!oldestFeature || loadingInfo.startTime < oldestFeature.startTime) {
          oldestFeature = { uuid, ...loadingInfo, parcelId }
        }
      }
    }

    // If we found an old feature that's been loading for more than the timeout, abort it
    if (oldestFeature && now - oldestFeature.startTime > DEFAULT_TIMEOUT) {
      oldestFeature.abortController.abort('ABORT:feature creation timed out')
    }
  }

  private handleDeactivations(): boolean {
    const hadAnyDeactivations = this.deactivationQueue.length > 0

    while (this.deactivationQueue.length > 0) {
      const deactivate = this.deactivationQueue.shift()
      if (!deactivate) continue

      // Clean up instance relations for parcel being deactivated
      this.instanceRelations.delete(deactivate.parcel.id)

      // Clean up any active AbortControllers for this parcel
      const tracking = this.parcelStates.get(deactivate.parcel.id)
      if (tracking) {
        for (const loadingInfo of tracking.loadingFeatures.values()) {
          loadingInfo.abortController.abort('ABORT: disposing FeaturePump')
        }
        tracking.loadingFeatures.clear()
      }

      // Remove parcel from state tracking
      this.parcelStates.delete(deactivate.parcel.id)
      deactivate.features.forEach((f) => f.dispose())
      deactivate.onDone()
    }
    this.deactivationQueue.length = 0
    return hadAnyDeactivations
  }

  private applyWorkerSortOrder(loadOrder: LoadOrderItem[]): void {
    // Create a UUID -> original feature map for all features with instance detection complete
    const featureMap = new Map<string, FeatureRecord>()
    const readyParcels = this.getParcelsByState(ParcelProcessingState.INSTANCE_DETECTION_COMPLETE)

    for (const tracking of readyParcels) {
      for (const feature of tracking.features) {
        if (!this.isFeatureAlreadyCreated(feature, tracking.parcel)) {
          featureMap.set(feature.uuid, feature)
        }
      }
    }

    // Convert worker load order (with sorted UUIDs) to load queue with original features
    this.loadQueue = loadOrder
      .map((item) => {
        if (Array.isArray(item)) {
          // Group of UUIDs - map each UUID to original feature
          return item.map((uuid) => featureMap.get(uuid)).filter(Boolean) as FeatureRecord[]
        } else {
          // Single UUID - map to original feature
          return featureMap.get(item)
        }
      })
      .filter(Boolean) as LoadItem[]
  }

  private getSortableFeatures(): SortableFeature[] {
    const sortableFeatures: SortableFeature[] = []
    const readyParcels = this.getParcelsByState(ParcelProcessingState.INSTANCE_DETECTION_COMPLETE)

    for (const tracking of readyParcels) {
      const newFeatures = tracking.features.filter((feature) => !this.isFeatureAlreadyCreated(feature, tracking.parcel))

      for (const feature of newFeatures) {
        if (!tracking.parcel.transform?.position) {
          throw new Error(`Parcel ${tracking.parcel.id} missing transform.position - this is a data integrity issue`)
        }

        // Pre-compute world position: parcel.position + feature.position
        const parcelPos = tracking.parcel.transform.position
        const featurePos = tidyVec3(feature.position)
        const featureScale = tidyVec3(feature.scale)

        sortableFeatures.push({
          uuid: feature.uuid,
          type: feature.type,
          worldPosition: [parcelPos.x + featurePos[0], parcelPos.y + featurePos[1], parcelPos.z + featurePos[2]],
          scale: featureScale,
          groupId: feature.groupId || undefined,
          parcelId: tracking.parcel.id,
        })
      }
    }

    return sortableFeatures
  }

  private isFeatureAlreadyCreated(feature: FeatureRecord, parcel: Parcel): boolean {
    return parcel.featuresList?.some((f) => f.uuid === feature.uuid) ?? false
  }

  private removeParcelFromQueues(parcelId: number): void {
    const parcel = this.parcelStates.get(parcelId)
    if (!parcel) return

    const parcelFeatureUuids = new Set(parcel.features.map((f) => f.uuid))

    this.loadQueue = this.loadQueue.filter((item) => {
      if (Array.isArray(item)) {
        const filtered = item.filter((f) => !parcelFeatureUuids.has(f.uuid))
        return filtered.length > 0
      } else {
        return !parcelFeatureUuids.has(item.uuid)
      }
    })
  }

  private processFeatureGroup(features: FeatureRecord[]): void {
    // For instance groups, we need to process sequentially to avoid race conditions
    // where instances are processed before their base feature is created
    const hasInstances = this.groupHasInstances(features)

    if (hasInstances) {
      this.processFeatureWithInstanceChaining(features)
      return
    }

    for (const feature of features) {
      this.processFeature(feature)
    }
  }

  private processFeatureWithInstanceChaining(features: FeatureRecord[]): void {
    if (features.length === 0) return

    const baseFeature = features[0]
    const parcel = this.findParcelContaining(baseFeature.uuid)
    if (!parcel) return

    // Start base feature creation and get its promise
    const basePromise = this.createFeatureWithTracking(baseFeature, parcel)

    // Chain remaining features (instances) to process after base is complete
    if (features.length > 1) {
      this.chainInstanceCreation(basePromise, features.slice(1))
    }
  }

  private chainInstanceCreation(basePromise: Promise<void>, instances: FeatureRecord[]): void {
    // Chain each instance creation after the base feature completes
    let chain = basePromise

    for (const instance of instances) {
      chain = chain
        .then(() => {
          return this.processFeatureAsync(instance)
        })
        .catch(() => {
          // If base feature failed, still try to create instance as regular feature
          return this.processFeatureAsync(instance)
        })
    }
  }

  private groupHasInstances(features: FeatureRecord[]): boolean {
    if (features.length <= 1) return false

    // If all features are groups (type: 'group'), they don't have instances between them
    if (features.every((f) => f.type === 'group')) return false

    // If worker data is available, use it for precise detection
    if (this.instanceRelations.size > 0) {
      return features.some((feature) => {
        // Check if this feature is an instance in any parcel
        for (const parcelRelations of this.instanceRelations.values()) {
          if (parcelRelations.has(feature.uuid)) {
            return true
          }
        }
        return false
      })
    }

    // Conservative fallback: assume non-group features might have instances
    // Groups themselves don't instance each other, only regular features do
    return features.some((f) => f.type !== 'group')
  }

  private processFeature(feature: FeatureRecord): void {
    const parcel = this.findParcelContaining(feature.uuid)
    if (parcel) {
      const rootFeature = this.findRootFeature(feature)
      // Fire and forget - we don't need to wait for completion in regular processing
      this.createFeatureWithTracking(feature, parcel, rootFeature)
    }
  }

  private async processFeatureAsync(feature: FeatureRecord): Promise<void> {
    const parcel = this.findParcelContaining(feature.uuid)
    if (parcel) {
      const rootFeature = this.findRootFeature(feature)
      // Wait for completion in promise chains
      return this.createFeatureWithTracking(feature, parcel, rootFeature)
    }
  }

  private findParcelContaining(featureUuid: string): Parcel | undefined {
    // Find which parcel this feature belongs to
    for (const tracking of this.parcelStates.values()) {
      if (tracking.features.some((f) => f.uuid === featureUuid)) {
        return tracking.parcel
      }
    }
    return undefined
  }

  private findRootFeature(feature: FeatureRecord): Feature | undefined {
    // Find the parcel this feature belongs to
    const parcel = this.findParcelContaining(feature.uuid)
    if (!parcel) {
      return undefined
    }

    const tracking = this.parcelStates.get(parcel.id)
    if (!tracking) {
      return undefined
    }

    // Use worker-computed instance data to find what the base feature should be
    const parcelInstanceRelations = this.instanceRelations.get(parcel.id)
    const baseFeatureUuid = parcelInstanceRelations?.get(feature.uuid)

    if (!baseFeatureUuid) {
      // This feature is not an instance of anything
      return undefined
    }

    // Look up the base feature in the parcel's already-created features
    const baseFeature = parcel.featuresList?.find((f) => f.uuid === baseFeatureUuid)

    return baseFeature || undefined
  }

  private createFeatureWithTracking(feature: FeatureRecord, parcel: Parcel, rootFeature?: Feature): Promise<void> {
    // Skip if feature already exists to prevent duplicates
    if (this.isFeatureAlreadyCreated(feature, parcel)) {
      // Don't update progress - this feature was already counted when it was first created
      return Promise.resolve()
    }

    // Increment loading count when starting
    const tracking = this.parcelStates.get(parcel.id)
    if (!tracking) {
      return Promise.resolve()
    }

    tracking.loadingFeatureCount++

    // Create AbortController for this feature
    const abortController = new AbortController()
    const startTime = performance.now()
    tracking.loadingFeatures.set(feature.uuid, { startTime, abortController })

    // Create a wrapper promise that can be aborted
    return new Promise<void>((resolve, reject) => {
      // Listen for abort signal
      abortController.signal.addEventListener('abort', () => {
        reject(new Error('Feature creation aborted due to timeout'))
      })

      // Start the actual feature creation
      parcel
        .createFeature(feature, rootFeature)
        .then(() => {
          // Check if we were aborted while creating
          if (abortController.signal.aborted) {
            reject(new Error('Feature creation aborted due to timeout'))
            return
          }
          resolve()
        })
        .catch(reject)
    })
      .then(() => {
        // Decrement loading count when done
        const tracking = this.parcelStates.get(parcel.id)
        if (tracking) {
          tracking.loadingFeatureCount = Math.max(0, tracking.loadingFeatureCount - 1)
          tracking.loadingFeatures.delete(feature.uuid)
        }
        this.updateProgressTracking(parcel)
      })
      .catch((error) => {
        // Handle errors and timeouts
        const tracking = this.parcelStates.get(parcel.id)
        if (tracking) {
          tracking.loadingFeatureCount = Math.max(0, tracking.loadingFeatureCount - 1)
          tracking.loadingFeatures.delete(feature.uuid)

          // Check if this was a timeout
          if (error.message === 'Feature creation aborted due to timeout') {
            tracking.timedOutFeatureCount++
          } else {
            tracking.erroredFeatureCount++
          }
        }
        // Don't increment completed count for timeouts - they are failures
        this.updateProgressTracking(parcel, true)
      })
  }

  private updateProgressTracking(parcel: Parcel, isError = false): void {
    const tracking = this.parcelStates.get(parcel.id)

    if (tracking) {
      if (!isError) {
        tracking.completedFeatureCount++
      }

      // Check if all features are done (either completed, errored, or timed out)
      const totalProcessed = tracking.completedFeatureCount + tracking.erroredFeatureCount + tracking.timedOutFeatureCount
      if (totalProcessed >= tracking.expectedFeatureCount) {
        tracking.onDone(parcel)
      }
    }
  }

  /**
   * Calculates the alignment between two direction vectors using dot product.
   * Returns 1.0 for identical directions, 0.0 for perpendicular, -1.0 for opposite.
   * Returns 1.0 if either vector is invalid (zero length).
   */
  private calculateDirectionAlignment(directionA: BABYLON.Vector3, directionB: BABYLON.Vector3): number {
    // Calculate vector lengths
    const lengthA = directionA.length()
    const lengthB = directionB.length()

    if (lengthA === 0 || lengthB === 0) {
      return 1.0 // Treat invalid directions as unchanged
    }

    // Normalize vectors and calculate dot product
    const normalizedA = directionA.normalizeToNew()
    const normalizedB = directionB.normalizeToNew()

    return BABYLON.Vector3.Dot(normalizedA, normalizedB)
  }

  /**
   * State machine for worker operations - ensures mutual exclusion between sorting and instance detection
   * Uses worker manager's state to prevent inconsistencies
   */
  private tryStartWorkerOperation(): void {
    // Worker is busy, skip this pump cycle
    if (this.workerManager.getWorkerState() !== 'idle') {
      return
    }

    // Priority 1: Instance detection (must happen before features can be activated)
    const pendingParcels = this.getParcelsByState(ParcelProcessingState.PENDING_INSTANCE_DETECTION)
    const hasPendingInstanceDetection = pendingParcels.length > 0
    if (hasPendingInstanceDetection) {
      this.startInstanceDetection()
      return
    }

    // Priority 2: Sorting (optimize load order)
    if (this.needsSorting) {
      this.startSorting()
      this.needsSorting = false
      return
    }
  }

  private startSorting(): Promise<void> {
    const sortStartTime = performance.now()
    this._stats.lastSortTimestamp = sortStartTime
    this._stats.currentBusyOperations = 'sorting'
    const sortableFeatures = this.getSortableFeatures()

    if (sortableFeatures.length === 0) {
      this.loadQueue = []
      this._stats.lastSortDuration = 0
      this._stats.currentBusyOperations = ''
      return Promise.resolve()
    }

    // Update last sort position/direction to current values before sorting
    this.lastSortPosition.copyFrom(this.cameraPosition)
    this.lastSortDirection.copyFrom(this.cameraDirection)

    // Use actual draw distance from scene settings, fallback to 128 if not available
    const maxDrawDistance = (this.scene as any).draw?.distance || 128

    return this.workerManager
      .requestFeatureSortingWithVectors(sortableFeatures, this.instanceRelations, this.cameraPosition, this.cameraDirection, maxDrawDistance, this.currentParcel?.id)
      .then((loadOrder) => {
        // Use worker result to sort original features and put them in load queue
        this.applyWorkerSortOrder(loadOrder)
        this._stats.lastSortDuration = performance.now() - sortStartTime
        this._stats.lastSortTimestamp = sortStartTime
        this._stats.totalSortsCompleted++
      })
      .catch((error) => {
        console.warn('FeaturePump: Async sorting failed, sorting skipped:', error)
        throw error // Re-throw to let caller handle state
      })
      .finally(() => {
        this._stats.currentBusyOperations = ''
      })
  }

  private startInstanceDetection(): Promise<void> {
    const awaitingParcels = this.getParcelsByState(ParcelProcessingState.PENDING_INSTANCE_DETECTION)
    if (awaitingParcels.length === 0) {
      return Promise.resolve()
    }

    const allFeatures: FeatureRecord[] = []
    const parcelIds: number[] = []

    for (const tracking of awaitingParcels) {
      allFeatures.push(...tracking.features)
      parcelIds.push(tracking.parcel.id)
    }

    return this.workerManager
      .requestInstanceIdentification(allFeatures)
      .then((instanceRelations) => {
        this.moveProcessedParcelsToActivationQueue(parcelIds, instanceRelations)
      })
      .catch((error) => {
        console.warn('FeaturePump: Batched instance detection failed:', error)
        this.moveProcessedParcelsToActivationQueue(parcelIds)
        throw error // Re-throw to let caller handle state
      })
  }

  private moveProcessedParcelsToActivationQueue(parcelIds: number[], instanceRelations?: Map<string, string>): void {
    // Store instance relations by parcel ID for efficient cleanup
    if (instanceRelations) {
      for (const parcelId of parcelIds) {
        const tracking = this.parcelStates.get(parcelId)
        if (!tracking) continue

        // Create parcel-specific instance relations map
        const parcelInstanceRelations = new Map<string, string>()
        for (const feature of tracking.features) {
          const baseUuid = instanceRelations.get(feature.uuid)
          if (baseUuid) {
            parcelInstanceRelations.set(feature.uuid, baseUuid)
          }
        }

        if (parcelInstanceRelations.size > 0) {
          this.instanceRelations.set(parcelId, parcelInstanceRelations)
        }
      }
    }

    // Transition parcels from PENDING_INSTANCE_DETECTION to INSTANCE_DETECTION_COMPLETE
    for (const parcelId of parcelIds) {
      this.atomicStateChange(parcelId, ParcelProcessingState.PENDING_INSTANCE_DETECTION, ParcelProcessingState.INSTANCE_DETECTION_COMPLETE)
    }
  }

  /**
   * Get total number of features currently being loaded across all parcels
   */
  private getTotalLoadingFeatureCount(): number {
    let total = 0
    for (const tracking of this.parcelStates.values()) {
      total += tracking.loadingFeatureCount
    }
    return total
  }

  /**
   * Disposes of the FeaturePump and its worker manager.
   */
  public dispose(): void {
    // Clean up all active AbortControllers
    for (const tracking of this.parcelStates.values()) {
      for (const loadingInfo of tracking.loadingFeatures.values()) {
        loadingInfo.abortController.abort('ABORT:disposing FeaturePump')
      }
      tracking.loadingFeatures.clear()
    }

    // Clear all queues and data
    this.parcelStates.clear()
    this.deactivationQueue = []
    this.loadQueue = []
    this.instanceRelations.clear()
  }
}
