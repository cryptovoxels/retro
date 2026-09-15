// ABOUTME: Debug tab for monitoring Ocean system statistics and performance metrics
// ABOUTME: Shows real-time ocean stats including instances, custom meshes, chunk processing status

import type { IDebugTab } from './base-debug'
import { getWorldTerrain } from '../../init/world-scene'

export class OceanDebugTab implements IDebugTab {
  readonly name = 'Ocean Debug'

  private scene: BABYLON.Scene
  private statsText: BABYLON.GUI.TextBlock | null = null

  constructor(scene: BABYLON.Scene) {
    this.scene = scene
  }

  createContent(): BABYLON.GUI.Control {
    // Create main container
    const container = new BABYLON.GUI.Rectangle('oceanDebugContainer')
    container.color = 'transparent'
    container.thickness = 0

    // Create stats text block
    this.statsText = new BABYLON.GUI.TextBlock('oceanStats', 'Loading ocean statistics...')
    this.statsText.color = '#cccccc'
    this.statsText.fontSize = 12
    this.statsText.fontFamily = 'Consolas, monospace'
    this.statsText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
    this.statsText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP
    this.statsText.paddingTopInPixels = 10
    this.statsText.paddingLeftInPixels = 15

    container.addControl(this.statsText)

    return container
  }

  updateContent(): void {
    if (!this.statsText) return

    const ocean = this.getOcean()
    if (!ocean) {
      this.statsText.text = 'Ocean not available\n\nTerrain system may not be loaded yet'
      return
    }

    // Get camera info if available
    const camera = this.scene.activeCamera
    const cameraPos = camera ? camera.position : null

    // Access ocean internal state using type assertion to access private fields
    const oceanInternal = ocean as any

    // Count instances and custom meshes
    const instanceCount = oceanInternal.instances?.size || 0
    const customMeshCount = oceanInternal.customMeshes?.size || 0
    const islandsCount = oceanInternal.islands?.length || 0

    // Get instance details
    const instanceLines: string[] = []
    if (oceanInternal.instances && oceanInternal.instances.size > 0) {
      const instanceEntries = Array.from(oceanInternal.instances.entries()) as [string, any][]
      const sortedInstanceEntries = instanceEntries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 10) // Show first 10 instances

      for (const [key, instance] of sortedInstanceEntries) {
        const pos = instance.position
        instanceLines.push(`  ${key}: (${pos.x.toFixed(0)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(0)})`)
      }

      if (oceanInternal.instances.size > 10) {
        instanceLines.push(`  ... and ${oceanInternal.instances.size - 10} more`)
      }
    }

    if (instanceLines.length === 0) {
      instanceLines.push('  (no instances)')
    }

    // Get custom mesh details
    const customMeshLines: string[] = []
    if (oceanInternal.customMeshes && oceanInternal.customMeshes.size > 0) {
      const customMeshEntries = Array.from(oceanInternal.customMeshes.entries()) as [string, any][]
      const sortedCustomMeshEntries = customMeshEntries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 8) // Show first 8 custom mesh groups

      for (const [key, meshArray] of sortedCustomMeshEntries) {
        const meshCount = Array.isArray(meshArray) ? meshArray.length : 1
        const firstMesh = Array.isArray(meshArray) ? meshArray[0] : meshArray
        if (firstMesh && firstMesh.position) {
          const pos = firstMesh.position
          customMeshLines.push(`  ${key}: ${meshCount} mesh${meshCount !== 1 ? 'es' : ''} @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(0)})`)
        } else {
          customMeshLines.push(`  ${key}: ${meshCount} mesh${meshCount !== 1 ? 'es' : ''} (no position)`)
        }
      }

      if (oceanInternal.customMeshes.size > 8) {
        customMeshLines.push(`  ... and ${oceanInternal.customMeshes.size - 8} more`)
      }
    }

    if (customMeshLines.length === 0) {
      customMeshLines.push('  (no custom meshes)')
    }

    // Calculate mesh statistics
    let totalTriangles = 0
    let totalVertices = 0
    if (oceanInternal.customMeshes) {
      for (const meshArray of oceanInternal.customMeshes.values() as Iterable<any>) {
        const meshes = Array.isArray(meshArray) ? meshArray : [meshArray]
        for (const mesh of meshes) {
          if (mesh && mesh.getTotalVertices) {
            const vertexCount = mesh.getTotalVertices()
            totalVertices += vertexCount
            totalTriangles += Math.floor(vertexCount / 3)
          }
        }
      }
    }

    // Get current island information
    const getCurrentIsland = (): string => {
      const grid = (window as any).grid
      if (!grid || !grid.currentIsland) return '(none)'
      return grid.currentIsland
    }

    // Format the main stats display
    const lines = [
      cameraPos ? `Camera: (${cameraPos.x.toFixed(0)}, ${cameraPos.y.toFixed(0)}, ${cameraPos.z.toFixed(0)})` : 'Camera: unknown',
      `Current island: ${getCurrentIsland()}`,
      '',
      `Islands loaded: ${islandsCount}`,
      `Instances: ${instanceCount}`,
      `Custom meshes: ${customMeshCount}`,
      '',
      `Total vertices: ${totalVertices.toLocaleString()}`,
      `Total triangles: ${totalTriangles.toLocaleString()}`,
      '',
      'Instances (chunk_coord -> world_pos):',
      ...instanceLines.slice(0, 8), // Limit to 8 lines for space
      '',
      'Custom meshes (chunk_coord -> info):',
      ...customMeshLines.slice(0, 6), // Limit to 6 lines for space
    ]

    // Filter out empty strings and join
    this.statsText.text = lines.join('\n')
  }

  private getOcean(): any {
    const terrain = (window as any).main ? getWorldTerrain() : null
    if (!terrain) return null
    return (terrain as any)._ocean || null
  }

  dispose(): void {
    this.statsText = null
  }
}
