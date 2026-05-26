// ABOUTME: Voxel terrain system - generates 64x64x64 chunks around camera
// ABOUTME: Uses ao-mesher, glass for water, no old ocean/island systems

import { isLoaded } from '../utils/loading-done'
import { StateObservable } from '../utils/state-observable'
import { generateTerrainChunk, type TerrainChunkInput } from './terrain-voxel'
import type { IslandRecord } from '../../common/messages/api-islands'

const COORD_SCALE = 100 // island coords are 1/100th of world coords

export class Terrain {
  public islandsStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')
  public invalidateIslandsLoaded: () => void

  private readonly _scene: BABYLON.Scene
  private readonly _parent: BABYLON.TransformNode

  private _landMesh: BABYLON.Mesh | null = null
  private _waterMesh: BABYLON.Mesh | null = null
  private _lastCenter: { x: number; z: number } | null = null
  private _islandRings: [number, number][][] = []
  private _isLoaded = false

  constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode, _skyboxes: any[]) {
    this._scene = scene
    this._parent = parent
    this.invalidateIslandsLoaded = () => this.islandsStateObservable.setState('unloaded')

    // Regenerate terrain every second
    setInterval(() => this._regenerateTerrain(), 1000)
  }

  private _convertIslandsToRings(islands: IslandRecord[]): [number, number][][] {
    const rings: [number, number][][] = []
    for (const island of islands) {
      for (const ring of island.geometry.coordinates) {
        const scaled: [number, number][] = ring.map(([x, z]) => [x * COORD_SCALE, z * COORD_SCALE])
        rings.push(scaled)
      }
    }
    return rings
  }

  private _regenerateTerrain() {
    const cam = this._scene.activeCamera
    if (!cam || !this._isLoaded || this._islandRings.length === 0) return

    const cx = Math.round(cam.position.x)
    const cz = Math.round(cam.position.z)

    // Skip if haven't moved much
    if (this._lastCenter) {
      const dx = cx - this._lastCenter.x
      const dz = cz - this._lastCenter.z
      if (dx * dx + dz * dz < 16 * 16) return
    }

    this._lastCenter = { x: cx, z: cz }

    const input: TerrainChunkInput = {
      centerX: cx,
      centerZ: cz,
      islands: this._islandRings,
      ponds: [],
      parcels: [],
    }

    try {
      console.log(`[terrain] generating at ${cx},${cz}...`)
      const t0 = performance.now()
      const data = generateTerrainChunk(input)
      console.log(`[terrain] done in ${(performance.now() - t0).toFixed(1)}ms`)

      // Dispose old meshes
      this._landMesh?.dispose()
      this._waterMesh?.dispose()
      this._landMesh = null
      this._waterMesh = null

      if (!data) return

      // Land mesh
      if (data.landPositions.length > 0) {
        const mesh = new BABYLON.Mesh('terrain_land', this._scene)
        const vd = new BABYLON.VertexData()
        vd.positions = data.landPositions
        vd.indices = data.landIndices
        vd.normals = data.landNormals
        vd.applyToMesh(mesh)

        mesh.parent = this._parent
        mesh.checkCollisions = true
        mesh.receiveShadows = true
        mesh.metadata = 'teleportable'

        const mat = new BABYLON.StandardMaterial('terrain_land_mat', this._scene)
        mat.diffuseColor = new BABYLON.Color3(0.7, 0.65, 0.5)
        mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1)
        mesh.material = mat

        this._landMesh = mesh
      }

      // Water mesh
      if (data.waterPositions.length > 0) {
        const mesh = new BABYLON.Mesh('terrain_water', this._scene)
        const vd = new BABYLON.VertexData()
        vd.positions = data.waterPositions
        vd.indices = data.waterIndices
        vd.normals = data.waterNormals
        vd.applyToMesh(mesh)

        mesh.parent = this._parent
        mesh.checkCollisions = false

        const mat = new BABYLON.StandardMaterial('terrain_water_mat', this._scene)
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.6)
        mat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5)
        mat.alpha = 0.7
        mesh.material = mat

        this._waterMesh = mesh
      }
    } catch (e) {
      console.error('[terrain] generation failed', e)
    }
  }

  get groundMeshes() {
    if (!this._isLoaded) return []
    if (this._landMesh) return [this._landMesh]
    return []
  }

  update() {
    // Nothing to do per-frame anymore
  }

  async load() {
    // Fetch island data directly
    const s = document.querySelector('script#islands')
    let islands: IslandRecord[]
    if (s) {
      islands = JSON.parse(s.innerHTML)
    } else {
      const response = await fetch('/api/islands.json')
      const data = await response.json()
      islands = data.islands
    }

    this._islandRings = this._convertIslandsToRings(islands)
    this._isLoaded = true
    this.islandsStateObservable.setState('loaded')

    // Generate initial terrain
    this._regenerateTerrain()
  }

  addReflectionMesh(_mesh: BABYLON.Mesh) {
    // No-op - old ocean system removed
  }

  removeReflectionMesh(_mesh: BABYLON.Mesh) {
    // No-op - old ocean system removed
  }

  hasWaterMeshAt(x: number, z: number) {
    for (const ring of this._islandRings) {
      if (this._pointInPolygon(x, z, ring)) return false
    }
    return true
  }

  private _pointInPolygon(x: number, z: number, ring: [number, number][]): boolean {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        zi = ring[i][1]
      const xj = ring[j][0],
        zj = ring[j][1]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside
      }
    }
    return inside
  }
}
