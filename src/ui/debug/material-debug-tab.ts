// ABOUTME: Debug tab for monitoring material and texture system statistics and performance
// ABOUTME: Shows real-time data from BABYLON.js scene including materials, textures, cache stats, and rendering metrics

import type { IDebugTab } from './base-debug'
import { getCacheStats } from '../../materials'
import { SceneContext } from '@babylonjs/lite'

export class MaterialDebugTab implements IDebugTab {
  readonly name = 'Material Debug'

  private scene: SceneContext
  private statsText: any | null = null
  private drawCallsHistory: number[] = []
  private lastDrawCallCount = 0
  private readonly MAX_HISTORY_SIZE = 60 // Keep 60 frames of history (about 1 second at 60fps)
  private sceneInstrumentation: any

  constructor(scene: SceneContext) {
    this.scene = scene
    this.sceneInstrumentation = (undefined as any /* todo(lite): new BABYLON.SceneInstrumentation(scene) */)
    this.sceneInstrumentation.captureFrameTime = true
    this.sceneInstrumentation.captureRenderTime = true
    this.sceneInstrumentation.captureInterFrameTime = true
  }

  createContent(): any {
    // Create main container
    const container = (undefined as any /* todo(lite): new BABYLON.GUI.Rectangle('materialDebugContainer') */)
    container.color = 'transparent'
    container.thickness = 0

    // Create stats text block
    this.statsText = (undefined as any /* todo(lite): new BABYLON.GUI.TextBlock('materialStats', 'Loading material statistics...') */)
    this.statsText.color = '#cccccc'
    this.statsText.fontSize = 12
    this.statsText.fontFamily = 'Consolas, monospace'
    this.statsText.textHorizontalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT */)
    this.statsText.textVerticalAlignment = (undefined as any /* todo(lite): BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP */)
    this.statsText.paddingTopInPixels = 10
    this.statsText.paddingLeftInPixels = 15

    container.addControl(this.statsText)

    return container
  }

  updateContent(): void {
    if (!this.statsText) return

    // Get camera info
    const camera = this.scene.activeCamera
    const cameraPos = camera ? camera.position : null

    // Get rendering mode
    const renderingMode = 'Standard'

    // Get basic scene statistics
    const totalMaterials = this.scene.materials.length
    const totalTextures = this.scene.textures.length
    const totalMeshes = this.scene.meshes.length
    const activeMeshes = this.scene.getActiveMeshes().length
    const totalVertices = this.scene.getTotalVertices()
    const activeIndices = this.scene.getActiveIndices()
    const triangles = Math.floor(activeIndices / 3)

    // Get MaterialLibrary cache stats
    const cacheStats = getCacheStats()

    // Get performance metrics
    const engine = this.scene.getEngine()
    const fps = engine.getFps().toFixed(1)

    // Track draw calls per frame and calculate median
    const drawCallsPerFrame = this.updateDrawCallsHistory()
    const drawCallsDisplay = drawCallsPerFrame.current !== null ? `${drawCallsPerFrame.current} (median: ${drawCallsPerFrame.median})` : 'N/A'

    // Analyze materials by type
    const materialTypes = this.getMaterialTypeBreakdown()

    // Get top 5 largest textures
    const largestTextures = this.getLargestTextures(5)

    // Get recent materials (last 5)
    const recentMaterials = this.getRecentMaterials(10)

    // Format the display
    const lines = [
      cameraPos ? `Camera: (${cameraPos.x.toFixed(0)}, ${cameraPos.y.toFixed(0)}, ${cameraPos.z.toFixed(0)})` : 'Camera: unknown',
      `Mode: ${renderingMode}`,
      '',
      `FPS: ${fps}`,
      `Frame time: ${this.sceneInstrumentation.frameTimeCounter.lastSecAverage.toFixed(1)}ms`,
      `Render time: ${this.sceneInstrumentation.renderTimeCounter.lastSecAverage.toFixed(1)}ms`,
      `Interframe time: ${this.sceneInstrumentation.interFrameTimeCounter.lastSecAverage.toFixed(1)}ms`,
      `Draw calls/frame: ${drawCallsDisplay}`,
      '',
      `Total materials: ${totalMaterials}`,
      `Total textures: ${totalTextures}`,
      `Total meshes: ${totalMeshes}`,
      `Active meshes: ${activeMeshes}`,
      '',
      `Total vertices: ${totalVertices.toLocaleString()}`,
      `Active indices: ${activeIndices.toLocaleString()}`,
      `Triangles: ${triangles.toLocaleString()}`,
      '',
      `Cache size: ${cacheStats.size}`,
      `Cache hit rate: ${cacheStats.hitRate} (${cacheStats.hits}/${cacheStats.requests})`,
      '',
      'Materials by type:',
      ...materialTypes,
      '',
      'Largest textures:',
      ...largestTextures,
      '',
      'Recent materials:',
      ...recentMaterials,
    ]

    this.statsText.text = lines.join('\n')
  }

  private updateDrawCallsHistory(): { current: number | null; median: number | null } {
    const drawCallsThisFrame = this.sceneInstrumentation.drawCallsCounter
    // Add to history (only if positive - avoid negative values on first frame)
    this.drawCallsHistory.push(drawCallsThisFrame.current)
    // Keep history size manageable
    if (this.drawCallsHistory.length > this.MAX_HISTORY_SIZE) {
      this.drawCallsHistory.shift()
    }
    // Return current frame draw calls and median
    return {
      current: drawCallsThisFrame.current ? drawCallsThisFrame.current : null,
      median: this.calculateMedian(),
    }
  }

  private calculateMedian(): number | null {
    if (this.drawCallsHistory.length === 0) {
      return null
    }

    // Sort the history array
    const sorted = [...this.drawCallsHistory].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)

    // Calculate median
    if (sorted.length % 2 === 0) {
      // Even number of elements - average of two middle values
      return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    } else {
      // Odd number of elements - middle value
      return sorted[middle]
    }
  }

  private getMaterialTypeBreakdown(): string[] {
    const typeCounts: Record<string, number> = {}

    for (const material of this.scene.materials) {
      const className = material.getClassName()
      typeCounts[className] = (typeCounts[className] || 0) + 1
    }

    const lines: string[] = []
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${type}: ${count}`)
    }

    if (lines.length === 0) {
      lines.push('  (no materials)')
    }

    return lines.slice(0, 8) // Limit to 8 types for space
  }

  private getLargestTextures(limit: number): string[] {
    const textureInfo: Array<{ name: string; size: string; area: number }> = []

    for (const texture of this.scene.textures) {
      try {
        const size = texture.getSize()
        if (size && size.width && size.height) {
          const area = size.width * size.height
          const sizeStr = `${size.width}x${size.height}`
          textureInfo.push({
            name: texture.name || 'unnamed',
            size: sizeStr,
            area: area,
          })
        }
      } catch (error) {
        // Some textures might not have size info
      }
    }

    // Sort by area (largest first)
    textureInfo.sort((a, b) => b.area - a.area)

    const lines: string[] = []
    for (const info of textureInfo.slice(0, limit)) {
      lines.push(`${info.size} ${info.name}`)
    }

    if (lines.length === 0) {
      lines.push('  (no textures with size info)')
    }

    return lines
  }

  private getRecentMaterials(limit: number): string[] {
    const lines: string[] = []

    // Get last N materials (most recently added to scene)
    const recentMaterials = this.scene.materials.slice(-limit).reverse()

    for (const material of recentMaterials) {
      const name = material.name || 'unnamed'
      const type = material.getClassName()
      lines.push(`  ${name} (${type})`)
    }

    if (lines.length === 0) {
      lines.push('  (no materials)')
    }

    return lines
  }

  dispose(): void {
    this.statsText = null
    this.drawCallsHistory = []
    this.lastDrawCallCount = 0
  }
}
