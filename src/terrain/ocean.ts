import type { Chunk, ChunkObserver } from './chunk-system'
import { type ClippedWaterGeometry, douglasPeucker, isAxisAlignedRectangle, type Point2D, PolygonClipping } from '../utils/polygon-utils'
import type { IslandRecord } from '../../common/messages/api-islands'
import Islands from './islands'
import { OCEAN_HEIGHT_OFFSET } from '../constants'

type IntersectionType = 'partial' | 'full'
type MeshPosition = { x: number; z: number }

interface PolygonClipInstruction {
  polygons: Point2D[][]
  operation: 'cut_water' | 'add_water'
  intersectionType: IntersectionType
}

function oceanMaterial(scene: BABYLON.Scene): BABYLON.StandardMaterial {
  const mat = new BABYLON.StandardMaterial('ocean', scene)
  mat.diffuseColor = new BABYLON.Color3(0, 0.4, 0.7)
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05)
  mat.alpha = 0.9
  mat.fogEnabled = true
  mat.freeze()
  mat.blockDirtyMechanism = true
  return mat
}

export class Ocean implements ChunkObserver {
  private static readonly NEW_ISLAND_ID_THRESHOLD = 40
  private static readonly COORDINATE_SCALE_FACTOR = 100

  private readonly size: number
  private readonly halfSize: number
  private readonly scene: BABYLON.Scene
  private readonly mesh: BABYLON.Mesh
  private readonly waterMaterial: BABYLON.StandardMaterial
  private instances: Map<string, BABYLON.InstancedMesh> = new Map()
  private customMeshes: Map<string, BABYLON.Mesh[]> = new Map()
  private processingChunks: Set<string> = new Set()
  private deferredChunks: Array<Chunk> = []
  private islands: IslandRecord[] = []

  private processingQueue: Array<Chunk> = []
  private readonly FRAME_BUDGET_MS = 8 // 8ms budget per frame for chunk processing
  private isProcessingQueue = false
  private islandBoundsCache = new Map<number, { minX: number; maxX: number; minZ: number; maxZ: number }>()

  constructor(size: number, scene: BABYLON.Scene) {
    this.size = size
    this.halfSize = size * 0.5
    this.scene = scene

    // set up the instance template
    this.mesh = BABYLON.MeshBuilder.CreateGround('ocean_original', { width: this.size, height: this.size, subdivisions: 1 }, scene)
    this.mesh.position.set(-99999, -99999, -99999)
    this.mesh.setEnabled(false)

    this.waterMaterial = oceanMaterial(scene)
    this.mesh.material = this.waterMaterial
  }

  createInstance(x: number, y: number): BABYLON.InstancedMesh {
    const i = this.mesh.createInstance(`ocean_i_${x}_${y}`)
    i.position.x = this.size * x + this.halfSize
    i.position.y = OCEAN_HEIGHT_OFFSET
    i.position.z = this.size * y + this.halfSize
    return i
  }

  getInstances = () => this.mesh.instances

  getCustomMeshes = () => this.customMeshes

  setIslands(islands: Islands): void {
    const islandData = islands.getIslandData()
    this.islandBoundsCache.clear()
    this.islands = islandData

    if (this.deferredChunks.length == 0) return

    const chunksToProcess = [...this.deferredChunks]
    this.deferredChunks = []

    this.processingQueue.push(...chunksToProcess)
    this.startProcessingQueue()
  }

  onChunkLoaded(chunk: Chunk): void {
    const key = `${chunk.gridX}_${chunk.gridZ}`

    if (this.instances.has(key) || this.customMeshes.has(key) || this.processingChunks.has(key)) {
      return
    }
    if (this.islands.length === 0) {
      this.deferredChunks.push(chunk)
      return
    }

    this.processingQueue.push(chunk)
    this.startProcessingQueue()
  }

  onChunkUnloaded(chunk: Chunk): void {
    const key = `${chunk.gridX}_${chunk.gridZ}`
    this.processingChunks.delete(key)

    const queueIndex = this.processingQueue.findIndex((c) => `${c.gridX}_${c.gridZ}` === key)
    if (queueIndex !== -1) {
      this.processingQueue.splice(queueIndex, 1)
    }

    const instance = this.instances.get(key)
    if (instance) {
      instance.dispose()
      this.instances.delete(key)
    }

    const customMeshes = this.customMeshes.get(key)
    if (customMeshes) {
      customMeshes.forEach((mesh) => mesh.dispose())
      this.customMeshes.delete(key)
    }
  }

  /**
   * Check if a water mesh (ocean tile or lake) exists at the given world position.
   * Used for underwater detection narrowphase.
   */
  hasWaterMeshAt(worldX: number, worldZ: number): boolean {
    const gridX = Math.floor(worldX / this.size)
    const gridZ = Math.floor(worldZ / this.size)
    const key = `${gridX}_${gridZ}`

    if (this.instances.has(key)) {
      return true
    }

    return this.customMeshes.has(key)
  }

  dispose(): void {
    this.processingQueue.length = 0
    this.isProcessingQueue = false

    this.instances.forEach((instance) => instance.dispose())
    this.instances.clear()

    this.customMeshes.forEach((meshes) => meshes.forEach((mesh) => mesh.dispose()))
    this.customMeshes.clear()

    this.mesh.dispose()
    this.waterMaterial.dispose()
  }

  private startProcessingQueue(): void {
    if (this.isProcessingQueue || this.processingQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true
    this.processChunkQueue()
  }

  private processChunkQueue(): void {
    const startTime = performance.now()

    while (this.processingQueue.length > 0 && performance.now() - startTime < this.FRAME_BUDGET_MS) {
      const chunk = this.processingQueue.shift()!
      this.processChunkImmediate(chunk)
    }

    if (this.processingQueue.length > 0) {
      requestAnimationFrame(() => this.processChunkQueue())
    } else {
      this.isProcessingQueue = false
    }
  }

  private processChunkImmediate(chunk: Chunk): void {
    const key = `${chunk.gridX}_${chunk.gridZ}`

    if (this.instances.has(key) || this.customMeshes.has(key) || this.processingChunks.has(key)) {
      return
    }

    this.processingChunks.add(key)
    try {
      const tileCenter: Point2D = { x: chunk.worldX + this.halfSize, z: chunk.worldZ + this.halfSize }
      this.processChunk(chunk, tileCenter, key)
    } catch (err) {
      console.error(`Failed to create ocean mesh for chunk ${key}:`, err)
    } finally {
      this.processingChunks.delete(key)
    }
  }

  private getIslandBounds(island: IslandRecord): { minX: number; maxX: number; minZ: number; maxZ: number } {
    if (!this.islandBoundsCache.has(island.id)) {
      const bounds = this.calculateIslandBounds(island)
      this.islandBoundsCache.set(island.id, bounds)
    }
    return this.islandBoundsCache.get(island.id)!
  }

  private calculateIslandBounds(island: IslandRecord): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity
    for (const ring of island.geometry.coordinates) {
      for (const coord of ring) {
        const x = coord[0] * Ocean.COORDINATE_SCALE_FACTOR
        const z = coord[1] * Ocean.COORDINATE_SCALE_FACTOR
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
    return { minX, maxX, minZ, maxZ }
  }

  private collectPolygonClipInstructions(tileCenter: Point2D): PolygonClipInstruction[] {
    const tileBounds = {
      minX: tileCenter.x - this.halfSize,
      maxX: tileCenter.x + this.halfSize,
      minZ: tileCenter.z - this.halfSize,
      maxZ: tileCenter.z + this.halfSize,
    }

    const clipInstructions: PolygonClipInstruction[] = []

    for (const island of this.islands) {
      const islandBounds = this.getIslandBounds(island)
      if (tileBounds.maxX < islandBounds.minX || tileBounds.minX > islandBounds.maxX || tileBounds.maxZ < islandBounds.minZ || tileBounds.minZ > islandBounds.maxZ) {
        continue
      }

      const rings = island.id >= Ocean.NEW_ISLAND_ID_THRESHOLD ? island.geometry.coordinates : [island.geometry.coordinates[0]]

      // Collect all intersecting polygons from all rings
      const intersectingPolygons: Point2D[][] = []
      let combinedIntersectionType: IntersectionType | null = null

      for (const ring of rings) {
        const polygon = this.convertCoordinatesToPolygon(ring)
        const intersectionType = this.determineIntersectionType(tileCenter, polygon)
        if (intersectionType) {
          intersectingPolygons.push(polygon)
          // Use 'partial' if any ring has partial intersection, otherwise 'full'
          if (intersectionType === 'partial') {
            combinedIntersectionType = 'partial'
          } else if (combinedIntersectionType === null) {
            combinedIntersectionType = 'full'
          }
        }
      }

      // Create ONE instruction for all rings of this island (not one per ring)
      if (intersectingPolygons.length > 0 && combinedIntersectionType) {
        clipInstructions.push({ polygons: intersectingPolygons, operation: 'cut_water', intersectionType: combinedIntersectionType })
      }

      if (island.lakes_geometry_json?.coordinates) {
        for (const lakeCoordinates of island.lakes_geometry_json.coordinates.map((lake) => lake[0])) {
          const lakePolygon = this.convertCoordinatesToPolygon(lakeCoordinates, 0.25)
          const intersectionType = this.determineIntersectionType(tileCenter, lakePolygon)
          if (intersectionType) {
            clipInstructions.push({ polygons: [lakePolygon], operation: 'add_water', intersectionType })
          }
        }
      }
    }
    return clipInstructions
  }

  private determineIntersectionType(tileCenter: Point2D, polygon: Point2D[]): IntersectionType | null {
    const tilePolygon = [
      { x: tileCenter.x - this.halfSize, z: tileCenter.z - this.halfSize },
      { x: tileCenter.x + this.halfSize, z: tileCenter.z - this.halfSize },
      { x: tileCenter.x + this.halfSize, z: tileCenter.z + this.halfSize },
      { x: tileCenter.x - this.halfSize, z: tileCenter.z + this.halfSize },
    ]

    // Check if there's any intersection at all
    const hasIntersection = tilePolygon.some((point) => PolygonClipping.pointInPolygon(point, polygon)) || polygon.some((p) => PolygonClipping.pointInPolygon(p, tilePolygon)) || PolygonClipping.polygonsIntersect(tilePolygon, polygon)

    if (!hasIntersection) return null

    // Always return 'partial' for intersections and let Martinez clipping
    // in createClippedWaterTile determine if water actually remains
    return 'partial'
  }

  private processChunk(chunk: Chunk, tileCenter: Point2D, key: string): void {
    const clipInstructions = this.collectPolygonClipInstructions(tileCenter)

    if (clipInstructions.length === 0) {
      this.instances.set(key, this.createInstance(chunk.gridX, chunk.gridZ))
      return
    }

    for (const instruction of clipInstructions) {
      if (instruction.operation === 'cut_water' && instruction.intersectionType === 'full') {
        continue
      }
      if (instruction.operation === 'cut_water' && instruction.intersectionType === 'partial') {
        this.createClippedWaterTile(chunk, tileCenter, key, instruction, false)
        continue
      }
      if (instruction.operation === 'add_water' && instruction.intersectionType === 'full') {
        this.instances.set(key, this.createInstance(chunk.gridX, chunk.gridZ))
        continue
      }
      if (instruction.operation === 'add_water' && instruction.intersectionType === 'partial') {
        this.createClippedWaterTile(chunk, tileCenter, key, instruction, true)
      }
    }
  }

  private createClippedWaterTile(chunk: Chunk, tileCenter: Point2D, key: string, instruction: PolygonClipInstruction, isInsideClipping: boolean): void {
    let clippedGeometry: ClippedWaterGeometry

    // Handle multi-polygon case (multiple rings from multi-ring islands)
    if (instruction.polygons.length > 1 && !isInsideClipping) {
      // Use multi-polygon clipping for multiple rings (e.g., Gaza with 7 rings)
      clippedGeometry = PolygonClipping.clipToOutsideMultiPolygon(tileCenter, this.size, instruction.polygons)
    } else {
      // Single polygon case - use existing logic
      const singlePolygon = instruction.polygons[0]
      if (isAxisAlignedRectangle(singlePolygon)) {
        clippedGeometry = PolygonClipping.clipAxisAlignedRectangle(tileCenter, this.size, singlePolygon, isInsideClipping)
      } else if (isInsideClipping) {
        clippedGeometry = PolygonClipping.clipToInsidePolygon(tileCenter, this.size, singlePolygon)
      } else {
        clippedGeometry = PolygonClipping.clipToOutsidePolygon(tileCenter, this.size, singlePolygon)
      }
    }

    if (clippedGeometry.shouldCreateMesh) {
      const polygons = clippedGeometry.polygons || [clippedGeometry.vertices]
      if (polygons.length > 0) {
        const mergedMesh = this.createMergedOceanMesh(chunk, polygons, key)
        const existingMeshes = this.customMeshes.get(key) || []
        this.customMeshes.set(key, [...existingMeshes, mergedMesh])
      }
    }
  }

  private createMergedOceanMesh(chunk: Chunk, polygonVerticesArray: Point2D[][], key: string, heightOverride?: number): BABYLON.Mesh {
    if (polygonVerticesArray.length === 0) {
      throw new Error(`No polygons provided for merged ocean mesh creation in chunk ${key}`)
    }

    const meshPosition = { x: this.size * chunk.gridX + this.halfSize, z: this.size * chunk.gridZ + this.halfSize }

    const mergedVertices: number[] = []
    const mergedIndices: number[] = []
    let vertexOffset = 0

    for (const polygonVertices of polygonVerticesArray) {
      if (polygonVertices.length < 3) continue // Skip invalid polygons @todo should we warn?

      const meshData = this.generateWorldVertices(polygonVertices)
      if (meshData.vertices.length === 0) continue // @todo should we warn?

      const localVertices = this.convertToLocalVertices(meshData.vertices, meshPosition)
      mergedVertices.push(...localVertices)
      const adjustedIndices = meshData.indices.map((index) => index + Math.floor(vertexOffset / 3))
      mergedIndices.push(...adjustedIndices)
      vertexOffset += localVertices.length
    }

    if (mergedVertices.length === 0) {
      throw new Error(`No valid geometry generated for merged ocean mesh in chunk ${key}`)
    }
    const mesh = this.createMeshWithGeometry(key, 0, mergedVertices, mergedIndices, chunk, meshPosition)
    this.configureMeshProperties(mesh, heightOverride)
    return mesh
  }

  private convertCoordinatesToPolygon(ring: number[][], nudge = 0): Point2D[] {
    return this.simplifyIslandGeometry(ring)
      .map((coord) => ({ x: coord[0] * Ocean.COORDINATE_SCALE_FACTOR + nudge, z: coord[1] * Ocean.COORDINATE_SCALE_FACTOR + nudge }))
      .reverse()
  }

  private simplifyIslandGeometry(ring: number[][], tolerance = 0.005): number[][] {
    if (ring.length < 4) return ring
    const simplified = douglasPeucker(ring, tolerance)
    return simplified.length >= 3 ? simplified : ring
  }

  private generateWorldVertices(polygonVertices: Point2D[]): { vertices: number[]; indices: number[] } {
    const polygonGeometry = { shouldCreateMesh: true, vertices: polygonVertices, polygons: [polygonVertices] }
    const meshData = PolygonClipping.createMeshVertices(polygonGeometry, 0)
    return {
      vertices: Array.from(meshData.vertices),
      indices: meshData.indices,
    }
  }

  private convertToLocalVertices(worldVertices: number[], meshPosition: MeshPosition): number[] {
    const localVertices: number[] = []
    for (let i = 0; i < worldVertices.length; i += 3) {
      const worldX = worldVertices[i]
      const worldY = worldVertices[i + 1]
      const worldZ = worldVertices[i + 2]
      localVertices.push(worldX - meshPosition.x, worldY, worldZ - meshPosition.z)
    }
    return localVertices
  }

  private createMeshWithGeometry(key: string, meshIndex: number, localVertices: number[], indices: number[], chunk: Chunk, meshPosition: MeshPosition): BABYLON.Mesh {
    const mesh = new BABYLON.Mesh(`ocean_clipped_${key}_${meshIndex}`, this.scene)
    const vertexData = this.createVertexData(localVertices, indices, chunk, meshPosition)
    vertexData.applyToMesh(mesh)
    mesh.position.set(meshPosition.x, 0, meshPosition.z)
    return mesh
  }

  private createVertexData(localVertices: number[], indices: number[], chunk: Chunk, meshPosition: MeshPosition): BABYLON.VertexData {
    const vertexData = new BABYLON.VertexData()
    vertexData.positions = localVertices
    vertexData.indices = indices // Use the proper earcut indices
    vertexData.uvs = this.generateUVCoordinates(localVertices, chunk, meshPosition)
    vertexData.normals = this.generateNormals(localVertices)
    return vertexData
  }

  private generateUVCoordinates(localVertices: number[], chunk: Chunk, meshPosition: MeshPosition): number[] {
    const uvs: number[] = []
    const vertexCount = localVertices.length / 3
    for (let i = 0; i < vertexCount; i++) {
      const localX = localVertices[i * 3]
      const localZ = localVertices[i * 3 + 2]
      const worldX = localX + meshPosition.x
      const worldZ = localZ + meshPosition.z
      const u = (worldX - chunk.worldX) / this.size
      const v = (worldZ - chunk.worldZ) / this.size
      uvs.push(u, v)
    }
    return uvs
  }

  private generateNormals(localVertices: number[]): number[] {
    const normals: number[] = []
    const vertexCount = localVertices.length / 3
    for (let i = 0; i < vertexCount; i++) {
      normals.push(0, 1, 0)
    }
    return normals
  }

  private configureMeshProperties(mesh: BABYLON.Mesh, heightOverride?: number): void {
    mesh.material = this.mesh.material
    const yPosition = heightOverride !== undefined ? heightOverride : OCEAN_HEIGHT_OFFSET
    mesh.position.set(mesh.position.x, yPosition, mesh.position.z)
    mesh.setEnabled(true)
    mesh.isVisible = true
  }
}
