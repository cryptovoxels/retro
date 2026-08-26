// ABOUTME: Debug tab for monitoring FeaturePump statistics and performance metrics
// ABOUTME: Shows real-time pump stats including deactivation queue, world position sorting, and instancing

import type { IDebugTab } from './base-debug'
import type { FeaturePump } from '../../pump/feature-pump'
import { PumpStatsReader } from '../../pump/pump-stats'
import { SceneContext } from '@babylonjs/lite'

export class PumpDebugTab implements IDebugTab {
  readonly name = 'Pump Debug'

  private scene: SceneContext
  private statsText: any | null = null
  private pendingFeaturesText: any | null = null
  private statsReader = new PumpStatsReader()

  constructor(scene: SceneContext) {
    this.scene = scene
  }

  createContent(): any {
    // Create main container
    const container = (undefined as any /* todo(lite): new BABYLON.GUI.Rectangle('pumpDebugContainer') */)
    container.color = 'transparent'
    container.thickness = 0

    // Create main stats text block
    this.statsText = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock('stats', 'Loading pump statistics...') */)
    this.statsText.color = '#cccccc'
    this.statsText.fontSize = 12
    this.statsText.fontFamily = 'Consolas, monospace'
    this.statsText.textHorizontalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT */)
    this.statsText.textVerticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP */)
    this.statsText.paddingLeftInPixels = 10
    this.statsText.paddingTopInPixels = 10

    container.addControl(this.statsText)

    // Create separate pending features text block for coloring
    this.pendingFeaturesText = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock('pendingFeatures', 'Pending features: 0/50') */)
    this.pendingFeaturesText.color = '#cccccc'
    this.pendingFeaturesText.fontSize = 12
    this.pendingFeaturesText.fontFamily = 'Consolas, monospace'
    this.pendingFeaturesText.textHorizontalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT */)
    this.pendingFeaturesText.textVerticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP */)
    this.pendingFeaturesText.paddingLeftInPixels = 10
    this.pendingFeaturesText.paddingTopInPixels = 153 // Position after Active features line

    container.addControl(this.pendingFeaturesText)

    return container
  }

  updateContent(): void {
    if (!this.statsText) return

    const pump = this.getPump()
    if (!pump) {
      this.statsText.text = 'FeaturePump not available\\n\\nCheck window.main.pump'
      return
    }

    const stats = this.statsReader.readStats(pump)

    // Get camera info if available
    const camera = this.scene.activeCamera
    const cameraPos = camera ? camera.position : null

    // Calculate total activity and status
    const totalActivity = stats.workQueueSize + stats.deactivationQueueSize
    const isActive = totalActivity > 0

    // Get worker internal timing from the worker manager
    const workerManager = (pump as any).workerManager
    const lastDetectionTiming = workerManager?.getLastDetectionTiming ? workerManager.getLastDetectionTiming() : null
    const lastSortingTiming = workerManager?.getLastSortingTiming ? workerManager.getLastSortingTiming() : null

    const workerTimingLines: string[] = []

    // Helper function to format response time | internal time (p5/p50/p95)
    const formatCombinedTiming = (responseTime: number | undefined, internalTime: number | undefined, p5?: number, median?: number, p95?: number): string => {
      const respTime = responseTime !== undefined ? `${Math.round(responseTime)}ms` : 'n/a'
      const intTime = internalTime !== undefined ? `${Math.round(internalTime)}ms` : 'n/a'

      if (p5 !== undefined && median !== undefined && p95 !== undefined) {
        return `${respTime} | ${intTime} (${Math.round(p5)}/${Math.round(median)}/${Math.round(p95)})`
      }
      return `${respTime} | ${intTime}`
    }

    // Show detection timing with response time and internal time
    const detectionPrefix = stats.currentBusyOperation === 'detection' ? '>' : ' '
    const detectionText = formatCombinedTiming(stats.lastDetectionResponseTime, lastDetectionTiming?.detection, stats.workerTimingDetectionP5, stats.workerTimingDetectionMedian, stats.workerTimingDetectionP95)
    workerTimingLines.push(`${detectionPrefix} Detection: ${detectionText}`)

    // Show sorting timing with response time and internal time
    const sortingPrefix = stats.currentBusyOperation === 'sorting' ? '>' : ' '
    const sortingText = formatCombinedTiming(stats.lastSortingResponseTime, lastSortingTiming?.sorting, stats.workerTimingSortingP5, stats.workerTimingSortingMedian, stats.workerTimingSortingP95)
    workerTimingLines.push(`${sortingPrefix} Sorting: ${sortingText}`)

    // Format sort time with 5th/median/95th percentiles
    const sortTimeText = (() => {
      const current = Math.round(stats.lastSortDuration || 0)
      if (stats.sortDurationP5 !== undefined && stats.sortDurationMedian !== undefined && stats.sortDurationP95 !== undefined) {
        return `${current}ms (${Math.round(stats.sortDurationP5)}/${Math.round(stats.sortDurationMedian)}/${Math.round(stats.sortDurationP95)})`
      }
      return `${current}ms`
    })()

    // Format active parcel statuses with realtime loading progress
    const parcelStatusLines: string[] = []
    if (stats.parcelStatuses && stats.parcelStatuses.size > 0) {
      const sortedParcels = Array.from(stats.parcelStatuses.values()).sort((a, b) => a.id - b.id)

      for (const parcelStatus of sortedParcels) {
        const prefix = parcelStatus.id === stats.currentParcelId ? '>' : ' '

        // Show flow: pending > loading > loaded (errors/timeouts)
        let statusText = `${parcelStatus.pending} > ${parcelStatus.loading} > ${parcelStatus.loaded}`
        if (parcelStatus.errored > 0 || parcelStatus.timedOut > 0) {
          statusText += ` (${parcelStatus.errored}/${parcelStatus.timedOut})`
        }

        // Only show state if it's not ready (to save space)
        let stateSuffix = ''
        if (parcelStatus.state === 'pending_instance_detection') {
          stateSuffix = ' detecting'
        } else if (parcelStatus.state === 'disposing') {
          stateSuffix = ' disposing'
        } else if (parcelStatus.state !== 'instance_detection_complete') {
          // Show any other non-ready state
          stateSuffix = ' ' + parcelStatus.state
        }
        // If state is 'instance_detection_complete' (ready), don't add any suffix

        parcelStatusLines.push(`${prefix} ${parcelStatus.id}: ${statusText}${stateSuffix}`)
      }
    }

    if (parcelStatusLines.length === 0) {
      parcelStatusLines.push('  (no active parcels)')
    }

    // Calculate total active (loaded) features across all parcels
    let totalActiveFeatures = 0
    if (stats.parcelStatuses) {
      for (const parcelStatus of stats.parcelStatuses.values()) {
        totalActiveFeatures += parcelStatus.loaded
      }
    }

    // Get loaded parcels count from grid
    const grid = (window as any).grid
    const loadedParcelsCount = grid?.parcels?.size || 0

    // Format the main stats display
    const lines = [
      cameraPos ? `Camera: (${cameraPos.x.toFixed(0)}, ${cameraPos.y.toFixed(0)}, ${cameraPos.z.toFixed(0)})` : 'Camera: unknown',
      `Current parcel: ${stats.currentParcelId ? `#${stats.currentParcelId}` : '(none)'}`,
      '',
      `Status: ${isActive ? 'active' : 'idle'}`,
      `Sort time: ${sortTimeText}`,
      '',
      `Loaded parcels: ${loadedParcelsCount}`,
      `Active parcels: ${stats.activeParcelsCount}`,
      `Active features: ${totalActiveFeatures}`,
      '',
      '',
      'Worker:',
      ...(stats.failedWorkerRequests && stats.failedWorkerRequests > 0 ? [`  Failed requests: ${stats.failedWorkerRequests}`] : []),
      ...workerTimingLines,
      '',
      'Parcel status:',
      ...parcelStatusLines,
      '',
      'pending > loading > loaded (err/timeout)',
    ]

    // Set the main stats text with actual newlines
    this.statsText.text = lines.join('\n')

    // Update the separate pending features TextBlock with conditional coloring
    if (this.pendingFeaturesText) {
      const pendingCount = stats.totalPendingFeatures || 0
      const maxPending = stats.maxConcurrentFeatures || 50

      this.pendingFeaturesText.text = `Pending features: ${pendingCount}/${maxPending}`

      // Turn red if at maximum, otherwise normal color
      if (pendingCount >= maxPending) {
        this.pendingFeaturesText.color = '#ff6666' // Red
      } else {
        this.pendingFeaturesText.color = '#cccccc' // Normal gray
      }
    }
  }

  private getPump(): FeaturePump | null {
    return (window as any).main?.pump || null
  }

  dispose(): void {
    this.statsText = null
    this.pendingFeaturesText = null
  }
}
