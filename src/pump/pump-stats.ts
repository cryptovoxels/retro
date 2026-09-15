// ABOUTME: Statistics reader for the pump module using built-in counters pattern
// ABOUTME: Reads pump state directly when needed, zero overhead when not used

import type { WorkerTiming } from './types'

export interface PumpStatistics {
  // Core pump state
  workQueueSize: number
  loadQueueSize: number
  deactivationQueueSize: number
  activeParcelsCount: number
  currentParcelId?: number | string

  // Sort timing
  lastSortDuration?: number
  sortDurationP5?: number
  sortDurationMedian?: number
  sortDurationP95?: number

  // Worker response times
  lastDetectionResponseTime?: number
  lastSortingResponseTime?: number
  detectionResponseTimeP5?: number
  detectionResponseTimeMedian?: number
  detectionResponseTimeP95?: number
  sortingResponseTimeP5?: number
  sortingResponseTimeMedian?: number
  sortingResponseTimeP95?: number

  // Worker internal timing
  workerTimingDetectionP5?: number
  workerTimingDetectionMedian?: number
  workerTimingDetectionP95?: number
  workerTimingSortingP5?: number
  workerTimingSortingMedian?: number
  workerTimingSortingP95?: number
  workerTimingSampleCounts?: {
    detection: number
    sorting: number
  }

  // Current state
  currentBusyOperation?: string
  failedWorkerRequests?: number
  totalPendingFeatures?: number
  maxConcurrentFeatures?: number

  // Per-parcel status
  parcelStatuses?: Map<
    number,
    {
      id: number
      pending: number
      loading: number
      loaded: number
      errored: number
      timedOut: number
      state: string
    }
  >
}

/**
 * Statistics reader that extracts performance data from pump's built-in counters
 * No performance overhead - only reads when debug UI requests it
 */
export class PumpStatsReader {
  private sortDurationHistory: number[] = []

  /**
   * Generates statistics by reading pump's built-in counters
   */
  readStats(pump: any): PumpStatistics {
    // Count work queue size efficiently
    let workQueueSize = 0
    for (const item of pump.loadQueue) {
      if (Array.isArray(item)) {
        workQueueSize += item.length
      } else {
        workQueueSize += 1
      }
    }

    // Per-parcel pending counts are calculated in parcelStatuses

    // Calculate separate detection and sorting response time statistics
    const workerManager = (pump as any).workerManager
    const detectionResponseTimes = workerManager?.getDetectionResponseTimes ? workerManager.getDetectionResponseTimes() : []
    const sortingResponseTimes = workerManager?.getSortingResponseTimes ? workerManager.getSortingResponseTimes() : []

    let lastDetectionResponseTime: number | undefined
    let lastSortingResponseTime: number | undefined
    let detectionResponseTimeP5: number | undefined
    let detectionResponseTimeMedian: number | undefined
    let detectionResponseTimeP95: number | undefined
    let sortingResponseTimeP5: number | undefined
    let sortingResponseTimeMedian: number | undefined
    let sortingResponseTimeP95: number | undefined

    // Detection response time calculations
    if (detectionResponseTimes.length > 0) {
      lastDetectionResponseTime = detectionResponseTimes[detectionResponseTimes.length - 1]

      if (detectionResponseTimes.length >= 5) {
        const sorted = [...detectionResponseTimes].sort((a, b) => a - b)
        const p5Index = Math.floor(sorted.length * 0.05)
        const p95Index = Math.floor(sorted.length * 0.95)
        const medianIndex = Math.floor(sorted.length * 0.5)

        detectionResponseTimeP5 = sorted[p5Index]
        detectionResponseTimeMedian = sorted[medianIndex]
        detectionResponseTimeP95 = sorted[p95Index]
      }
    }

    // Sorting response time calculations
    if (sortingResponseTimes.length > 0) {
      lastSortingResponseTime = sortingResponseTimes[sortingResponseTimes.length - 1]

      if (sortingResponseTimes.length >= 5) {
        const sorted = [...sortingResponseTimes].sort((a, b) => a - b)
        const p5Index = Math.floor(sorted.length * 0.05)
        const p95Index = Math.floor(sorted.length * 0.95)
        const medianIndex = Math.floor(sorted.length * 0.5)

        sortingResponseTimeP5 = sorted[p5Index]
        sortingResponseTimeMedian = sorted[medianIndex]
        sortingResponseTimeP95 = sorted[p95Index]
      }
    }

    // Calculate worker internal timing percentiles using separate histories
    const detectionTimingHistory = workerManager?.getDetectionTimingHistory ? workerManager.getDetectionTimingHistory() : []
    const sortingTimingHistory = workerManager?.getSortingTimingHistory ? workerManager.getSortingTimingHistory() : []

    let workerTimingDetectionP5: number | undefined
    let workerTimingDetectionMedian: number | undefined
    let workerTimingDetectionP95: number | undefined
    let workerTimingSortingP5: number | undefined
    let workerTimingSortingMedian: number | undefined
    let workerTimingSortingP95: number | undefined

    // Calculate sample counts using separate histories
    const workerTimingSampleCounts = {
      detection: detectionTimingHistory.length,
      sorting: sortingTimingHistory.length,
    }

    // Total timing percentiles removed - not used by debug UI

    // Calculate percentiles for detection timing (from detection history only)
    if (detectionTimingHistory.length >= 5) {
      const detectionTimes = detectionTimingHistory
        .filter((t: WorkerTiming) => t.detection !== undefined)
        .map((t: WorkerTiming) => t.detection!)
        .sort((a: number, b: number) => a - b)

      if (detectionTimes.length >= 5) {
        const detectionP5Index = Math.floor(detectionTimes.length * 0.05)
        const detectionP95Index = Math.floor(detectionTimes.length * 0.95)
        const detectionMedianIndex = Math.floor(detectionTimes.length * 0.5)
        workerTimingDetectionP5 = detectionTimes[detectionP5Index]
        workerTimingDetectionMedian = detectionTimes[detectionMedianIndex]
        workerTimingDetectionP95 = detectionTimes[detectionP95Index]
      }
    }

    // Calculate percentiles for sorting timing (from sorting history only)
    if (sortingTimingHistory.length >= 5) {
      const sortingTimes = sortingTimingHistory
        .filter((t: WorkerTiming) => t.sorting !== undefined)
        .map((t: WorkerTiming) => t.sorting!)
        .sort((a: number, b: number) => a - b)

      if (sortingTimes.length >= 5) {
        const sortingP5Index = Math.floor(sortingTimes.length * 0.05)
        const sortingP95Index = Math.floor(sortingTimes.length * 0.95)
        const sortingMedianIndex = Math.floor(sortingTimes.length * 0.5)
        workerTimingSortingP5 = sortingTimes[sortingP5Index]
        workerTimingSortingMedian = sortingTimes[sortingMedianIndex]
        workerTimingSortingP95 = sortingTimes[sortingP95Index]
      }
    }

    // Track sort duration history and calculate percentiles
    const lastSortDuration = pump.stats.lastSortDuration
    let sortDurationP5: number | undefined
    let sortDurationMedian: number | undefined
    let sortDurationP95: number | undefined

    if (lastSortDuration && lastSortDuration > 0) {
      this.sortDurationHistory.push(lastSortDuration)
      if (this.sortDurationHistory.length > 100) {
        // Keep last 100 samples for rolling percentiles
        this.sortDurationHistory.shift()
      }
    }

    if (this.sortDurationHistory.length >= 5) {
      const sorted = [...this.sortDurationHistory].sort((a, b) => a - b)
      const p5Index = Math.floor(sorted.length * 0.05)
      const p95Index = Math.floor(sorted.length * 0.95)
      const medianIndex = Math.floor(sorted.length * 0.5)

      sortDurationP5 = sorted[p5Index]
      sortDurationMedian = sorted[medianIndex]
      sortDurationP95 = sorted[p95Index]
    }

    return {
      // Current meaningful state
      workQueueSize,
      loadQueueSize: pump.loadQueue.length, // Raw queue length for debugging
      deactivationQueueSize: pump.deactivationQueue.length,
      activeParcelsCount: pump.parcelStates.size,
      currentParcelId: pump.currentParcel?.id,
      lastSortDuration,
      sortDurationP5,
      sortDurationMedian,
      sortDurationP95,
      lastDetectionResponseTime,
      lastSortingResponseTime,
      detectionResponseTimeP5,
      detectionResponseTimeMedian,
      detectionResponseTimeP95,
      sortingResponseTimeP5,
      sortingResponseTimeMedian,
      sortingResponseTimeP95,
      workerTimingDetectionP5,
      workerTimingDetectionMedian,
      workerTimingDetectionP95,
      workerTimingSortingP5,
      workerTimingSortingMedian,
      workerTimingSortingP95,
      workerTimingSampleCounts,
      currentBusyOperation: pump.stats.currentBusyOperations || undefined,
      failedWorkerRequests: pump.stats.failedWorkerRequests,
      totalPendingFeatures: pump.stats.totalPendingFeatures,
      maxConcurrentFeatures: pump.maxConcurrentFeaturesLimit,
      parcelStatuses: this.collectParcelStatuses(pump),
    }
  }

  private collectParcelStatuses(pump: any): Map<number, { id: number; pending: number; loading: number; loaded: number; errored: number; timedOut: number; state: string }> {
    const parcelStatuses = new Map()

    // Access parcelStates from the pump
    for (const [parcelId, tracking] of pump.parcelStates.entries()) {
      const loaded = tracking.completedFeatureCount
      const loading = tracking.loadingFeatureCount || 0
      const errored = tracking.erroredFeatureCount || 0
      const timedOut = tracking.timedOutFeatureCount || 0
      // Pending = total expected - loaded - currently loading - errored - timed out
      const pending = Math.max(0, tracking.expectedFeatureCount - loaded - loading - errored - timedOut)

      parcelStatuses.set(parcelId, {
        id: parcelId,
        pending,
        loading,
        loaded,
        errored,
        timedOut,
        state: tracking.state,
      })
    }

    return parcelStatuses
  }
}
