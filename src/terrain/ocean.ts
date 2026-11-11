import { runCompute } from '../mono-pool'
import { isMobile } from '../../common/helpers/detector'
import type { Chunk, ChunkObserver } from './chunk-system'
import { groundOffset, snapRing, type Point2D, PolygonClipping } from '../utils/polygon-utils'
import type { IslandRecord } from '../../common/messages/api-islands'
import Islands from './islands'
import { OCEAN_HEIGHT_OFFSET } from '../constants'
import { mirrorTexture } from '../utils/mirror'

type IntersectionType = 'partial' | 'full'

interface PolygonClipInstruction {
  polygons: Point2D[][]
  operation: 'cut_water' | 'add_water'
  intersectionType: IntersectionType
}

class TexasWater extends BABYLON.MaterialPluginBase {
  constructor(
    material: BABYLON.Material,
    private bounds: BABYLON.Vector4,
  ) {
    super(material, 'texasWater', 210, {}, true, false)
    this.registerForExtraEvents = true
    this._enable(true)
  }
  getClassName() {
    return 'TexasWater'
  }
  isCompatible() {
    return true
  }
  getUniforms(lang: BABYLON.ShaderLanguage) {
    return { ubo: [{ name: 'texasBounds', size: 4, type: 'vec4' }], fragment: lang === BABYLON.ShaderLanguage.WGSL ? 'uniform texasBounds: vec4f;' : 'uniform vec4 texasBounds;' }
  }
  hardBindForSubMesh(buffer: BABYLON.UniformBuffer) {
    buffer.updateVector4('texasBounds', this.bounds)
  }
  getCustomCode(stage: string, lang: BABYLON.ShaderLanguage) {
    if (stage !== 'fragment') return null
    const wg = lang === BABYLON.ShaderLanguage.WGSL,
      bounds = wg ? 'uniforms.texasBounds' : 'texasBounds',
      pos = wg ? 'fragmentInputs.vPositionW' : 'vPositionW'
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: `
      ${wg ? 'let' : 'vec2'} shore=max(max(${bounds}.xy-${pos}.xz,${pos}.xz-${bounds}.zw),${wg ? 'vec2f' : 'vec2'}(0.));
      ${wg ? 'let' : 'float'} turquoise=1.-smoothstep(0.,24.,length(shore));
      color=${wg ? 'vec4f' : 'vec4'}(mix(color.rgb,${wg ? 'vec3f' : 'vec3'}(.02,.31,.30)+color.rgb*${wg ? 'vec3f' : 'vec3'}(.25,.9,.85),turquoise),color.a);`,
    }
  }
}

function oceanMaterial(scene: BABYLON.Scene, size: number, texas: BABYLON.Vector4): BABYLON.StandardMaterial {
  const mat = new BABYLON.StandardMaterial('ocean', scene)
  new TexasWater(mat, texas)
  mat.diffuseColor = new BABYLON.Color3(0.18, 0.3, 0.32)
  mat.emissiveColor = new BABYLON.Color3(0.025, 0.045, 0.05)
  mat.specularColor = new BABYLON.Color3(0.02, 0.03, 0.03)
  mat.alpha = 1
  mat.fogEnabled = true
  if (!isMobile()) {
    mat.reflectionTexture = mirrorTexture(scene, OCEAN_HEIGHT_OFFSET)
    mat.reflectionTexture.level = 0.28
    mat.reflectionFresnelParameters = new BABYLON.FresnelParameters({ bias: 0.12, power: 2 })
  }

  // Sparse pixel wavelets, drawn once. No noise or per-frame texture uploads.
  const texture = new BABYLON.DynamicTexture('ocean_pixels', 32, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE)
  const ctx = texture.getContext()
  ctx.fillStyle = '#a3b5b5'
  ctx.fillRect(0, 0, 32, 32)
  for (let i = 0; i < 12; i++) {
    const x = (i * 17) % 32
    const y = (i * 29) % 32
    ctx.fillStyle = i % 3 === 0 ? '#bac9c7' : '#94aaaa'
    ctx.fillRect(x, y, 3 + (i % 5), 1)
    ctx.fillRect(x - 32, y, 3 + (i % 5), 1)
  }
  texture.update(false)
  texture.uScale = texture.vScale = size / 16
  mat.diffuseTexture = texture
  let elapsed = 0
  mat.customShaderNameResolve = (name, uniforms, _buffers, _samplers, defines, _attributes, options) => {
    // Keep this shader out of the island material's effect cache.
    ;(defines as any).OCEAN_RIPPLES = true
    ;(defines as BABYLON.MaterialDefines).rebuild()
    uniforms.push('rippleTime')
    options!.processFinalCode = (type, code) => {
      if (type !== 'fragment') return code
      return code.replace('void main(', 'uniform float rippleTime;\nvoid main(').replace(
        'coords.y=1.0-coords.y;',
        `coords.y=1.0-coords.y;
        vec2 wave = vPositionW.xz * 1.45;
        coords += 0.012 * vec2(
          sin(wave.x + cos(wave.y + rippleTime * 2.1) + rippleTime * 3.2),
          cos(wave.y + sin(wave.x - rippleTime * 1.7) + rippleTime * 2.8)
        );`,
      )
    }
    return name
  }
  mat.onBindObservable.add(() => {
    const effect = mat.getEffect()
    effect?.setFloat('rippleTime', elapsed)
  })
  const drift = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() / 1000
    texture.uOffset = (Math.floor(elapsed) % 32) / 32
    texture.vOffset = (Math.floor(elapsed * 0.25) % 32) / 32
  })
  mat.onDisposeObservable.add(() => {
    scene.onBeforeRenderObservable.remove(drift)
    texture.dispose()
  })
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
  private readonly texasBounds = new BABYLON.Vector4(1e6, 1e6, -1e6, -1e6)
  private instances: Map<string, BABYLON.InstancedMesh> = new Map()
  private customMeshes: Map<string, BABYLON.Mesh[]> = new Map()
  private processingChunks = new Map<string, symbol>()
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

    this.waterMaterial = oceanMaterial(scene, size, this.texasBounds)
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
    const texas = islandData.find((i) => i.name.toLowerCase() === 'texas')
    if (texas) {
      const b = this.getIslandBounds(texas)
      this.texasBounds.set(b.minX, b.minZ, b.maxX, b.maxZ)
    } else this.texasBounds.set(1e6, 1e6, -1e6, -1e6)

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
    this.deferredChunks = this.deferredChunks.filter((c) => c.gridX !== chunk.gridX || c.gridZ !== chunk.gridZ)

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
    this.processingChunks.clear()
    this.processingQueue.length = 0
    this.isProcessingQueue = false

    this.instances.forEach((instance) => instance.dispose())
    this.instances.clear()

    this.customMeshes.forEach((meshes) => meshes.forEach((mesh) => mesh.dispose()))
    this.customMeshes.clear()

    this.mesh.dispose()
    this.waterMaterial.reflectionTexture?.dispose()
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
      void this.processChunkImmediate(chunk)
    }

    if (this.processingQueue.length > 0) {
      this.scene.onBeforeRenderObservable.addOnce(() => this.processChunkQueue())
    } else {
      this.isProcessingQueue = false
    }
  }

  private async processChunkImmediate(chunk: Chunk) {
    const key = `${chunk.gridX}_${chunk.gridZ}`

    if (this.instances.has(key) || this.customMeshes.has(key) || this.processingChunks.has(key)) {
      return
    }

    const job = Symbol(key)
    this.processingChunks.set(key, job)
    try {
      const tileCenter: Point2D = { x: chunk.worldX + this.halfSize, z: chunk.worldZ + this.halfSize }
      await this.processChunk(chunk, tileCenter, key, job)
    } catch (err) {
      console.error(`Failed to create ocean mesh for chunk ${key}:`, err)
    } finally {
      if (this.processingChunks.get(key) === job) this.processingChunks.delete(key)
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
    const offset = groundOffset(island.texture)
    return { minX: minX + offset, maxX: maxX + offset, minZ: minZ + offset, maxZ: maxZ + offset }
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

      const offset = groundOffset(island.texture)
      const rings = island.id >= Ocean.NEW_ISLAND_ID_THRESHOLD ? island.geometry.coordinates : [island.geometry.coordinates[0]]

      // Collect all intersecting polygons from all rings
      const intersectingPolygons: Point2D[][] = []
      let combinedIntersectionType: IntersectionType | null = null

      for (const ring of rings) {
        const polygon = snapRing(ring, offset)
        if (polygon.length < 3) continue
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
          const lakePolygon = snapRing(lakeCoordinates, offset)
          if (lakePolygon.length < 3) continue
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

  private async processChunk(chunk: Chunk, tileCenter: Point2D, key: string, job: symbol) {
    const clipInstructions = this.collectPolygonClipInstructions(tileCenter)

    if (clipInstructions.length === 0) {
      this.instances.set(key, this.createInstance(chunk.gridX, chunk.gridZ))
      return
    }

    const land = clipInstructions.filter((i) => i.operation === 'cut_water').flatMap((i) => i.polygons)
    const lakes = clipInstructions.filter((i) => i.operation === 'add_water').flatMap((i) => i.polygons)
    const geo = await runCompute((worker) => worker.oceanMesh(chunk.worldX, chunk.worldZ, this.size, land, lakes))
    if (this.processingChunks.get(key) !== job || !geo.indices.length) return
    const mesh = new BABYLON.Mesh('ocean_clipped_' + key + '_0', this.scene)
    const data = new BABYLON.VertexData()
    Object.assign(data, geo)
    data.applyToMesh(mesh)
    mesh.material = this.mesh.material
    mesh.position.set(tileCenter.x, OCEAN_HEIGHT_OFFSET, tileCenter.z)
    this.customMeshes.set(key, [mesh])
  }
}
