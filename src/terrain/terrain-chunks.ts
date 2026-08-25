// ABOUTME: Chunk-based voxel terrain - sea floor, islands, lakes, water as voxels
// ABOUTME: Meshed via parcel buildCleanMesh on monoworker; only 4 nearest chunks live

import { unzlibSync } from 'fflate'
import ndarray, { type NdArray } from 'ndarray'
import { defaultColors } from '../../common/content/blocks'
import { CHUNK_HEIGHT_USED, CHUNK_VOXELS, CHUNK_WORLD, TILE, WATER_TOP_VOXEL, WORLD_Y0, chunkKey, isSolid, toMesherId } from '../../common/terrain/constants'
import { buildCleanMesh } from '../clean-mesher'
import { isShared } from '../materials'
import { runCompute } from '../mono-pool'
import { addVoxels, removeCollider } from '../physics/world'
import { StateObservable } from '../utils/state-observable'

type ChunkMeshes = {
  opaque: BABYLON.Mesh
  water: BABYLON.Mesh | null
  field: NdArray<Uint8Array>
}

const SHAPE: [number, number, number] = [CHUNK_VOXELS, CHUNK_VOXELS, CHUNK_VOXELS]
// worker bakes +0.5 Y_OFFSET into positions; cancel so voxel y=0 sits at WORLD_Y0
const MESH_Y = WORLD_Y0 - 0.5

let palette: BABYLON.Color3[] | null = null
let meshId = 0

function getPalette(): BABYLON.Color3[] {
  if (palette) return palette
  palette = defaultColors.map((c) => BABYLON.Color3.FromHexString(c))
  return palette
}

function expandField(packed: Uint8Array): NdArray<Uint16Array> {
  const out = new Uint16Array(CHUNK_VOXELS * CHUNK_VOXELS * CHUNK_VOXELS)
  for (let i = 0; i < packed.length; i++) out[i] = toMesherId(packed[i])
  return ndarray(out, SHAPE)
}

function generateOcean(): Uint8Array {
  const data = new Uint8Array(CHUNK_VOXELS * CHUNK_VOXELS * CHUNK_VOXELS)
  const field = ndarray(data, SHAPE)
  for (let x = 0; x < CHUNK_VOXELS; x++) {
    for (let z = 0; z < CHUNK_VOXELS; z++) {
      field.set(x, 0, z, TILE.SAND)
      field.set(x, 1, z, TILE.SAND)
      for (let y = 2; y <= WATER_TOP_VOXEL && y < CHUNK_HEIGHT_USED; y++) {
        field.set(x, y, z, TILE.WATER)
      }
    }
  }
  return data
}

function solidsOnly(packed: Uint8Array): Uint16Array {
  const out = new Uint16Array(CHUNK_VOXELS * CHUNK_VOXELS * CHUNK_VOXELS)
  for (let i = 0; i < packed.length; i++) {
    out[i] = isSolid(packed[i]) ? 1 : 0
  }
  return out
}

function disposeChunk(m: ChunkMeshes) {
  for (const mesh of [m.opaque, m.water]) {
    if (!mesh) continue
    if (mesh.material && !isShared(mesh.material)) mesh.material.dispose()
    mesh.dispose()
  }
}

export default class TerrainChunks {
  public islandsStateObservable = new StateObservable<'loaded' | 'unloaded'>('unloaded')
  private readonly scene: BABYLON.Scene
  private index = new Set<string>()
  private meshes = new Map<string, ChunkMeshes>()
  private loading = new Set<string>()
  private wanted = new Set<string>()
  private _ready = false

  constructor(scene: BABYLON.Scene) {
    this.scene = scene
  }

  invalidateIslandsLoaded() {
    this.islandsStateObservable.setState('unloaded')
  }

  async load(wx: number, wz: number): Promise<void> {
    try {
      const res = await fetch('/api/terrain/index.json')
      const json = await res.json()
      this.index.clear()
      for (const c of json.chunks || []) {
        this.index.add(chunkKey(c.x, c.y, c.z))
      }
    } catch (e) {
      console.error('terrain index fetch failed', e)
    }
    this._ready = true
    await this.updateAround(wx, wz)
    this.islandsStateObservable.setState('loaded')
  }

  get groundMeshes(): BABYLON.Mesh[] {
    const out: BABYLON.Mesh[] = []
    for (const m of this.meshes.values()) out.push(m.opaque)
    return out
  }

  hasWaterAt(wx: number, wy: number, wz: number): boolean {
    const cx = Math.floor(wx / CHUNK_WORLD)
    const cz = Math.floor(wz / CHUNK_WORLD)
    const key = chunkKey(cx, 0, cz)
    const chunk = this.meshes.get(key)
    if (!chunk) return wy < 0.25
    const lx = Math.floor((wx - cx * CHUNK_WORLD) / 0.5)
    const ly = Math.floor((wy - WORLD_Y0) / 0.5)
    const lz = Math.floor((wz - cz * CHUNK_WORLD) / 0.5)
    if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK_VOXELS || ly >= CHUNK_VOXELS || lz >= CHUNK_VOXELS) return false
    return chunk.field.get(lx, ly, lz) === TILE.WATER
  }

  hasLandAt(wx: number, wz: number): boolean {
    const cx = Math.floor(wx / CHUNK_WORLD)
    const cz = Math.floor(wz / CHUNK_WORLD)
    const key = chunkKey(cx, 0, cz)
    const chunk = this.meshes.get(key)
    if (!chunk) return false
    const lx = Math.floor((wx - cx * CHUNK_WORLD) / 0.5)
    const lz = Math.floor((wz - cz * CHUNK_WORLD) / 0.5)
    if (lx < 0 || lz < 0 || lx >= CHUNK_VOXELS || lz >= CHUNK_VOXELS) return false
    for (let y = 2; y < CHUNK_HEIGHT_USED; y++) {
      const t = chunk.field.get(lx, y, lz)
      if (t === TILE.DIRT || t === TILE.GRASS) return true
    }
    return false
  }

  // 4 nearest chunks: 2x2 block around rounded chunk coords
  async updateAround(wx: number, wz: number): Promise<void> {
    if (!this._ready) return
    const rx = Math.round(wx / CHUNK_WORLD)
    const rz = Math.round(wz / CHUNK_WORLD)
    const next = new Set<string>()
    for (const cx of [rx - 1, rx]) {
      for (const cz of [rz - 1, rz]) {
        next.add(chunkKey(cx, 0, cz))
      }
    }

    for (const key of this.wanted) {
      if (!next.has(key)) this.unloadKey(key)
    }
    this.wanted = next

    const loads: Promise<void>[] = []
    for (const key of next) {
      if (this.meshes.has(key) || this.loading.has(key)) continue
      const [cx, , cz] = key.split('_').map(Number)
      this.loading.add(key)
      loads.push(this.loadChunk(cx, cz, key).finally(() => this.loading.delete(key)))
    }
    if (loads.length) await Promise.all(loads)
  }

  private unloadKey(key: string) {
    this.wanted.delete(key)
    const m = this.meshes.get(key)
    if (!m) return
    removeCollider(`terrain-${key}`)
    disposeChunk(m)
    this.meshes.delete(key)
  }

  private async loadChunk(cx: number, cz: number, key: string): Promise<void> {
    let packed: Uint8Array
    if (this.index.has(key)) {
      try {
        const res = await fetch(`/api/terrain/${cx}/0/${cz}.bin`)
        if (!res.ok) {
          packed = generateOcean()
        } else {
          packed = unzlibSync(new Uint8Array(await res.arrayBuffer()))
        }
      } catch {
        packed = generateOcean()
      }
    } else {
      packed = generateOcean()
    }

    if (!this.wanted.has(key) || this.meshes.has(key)) return

    const field16 = expandField(packed)
    const id = ++meshId
    const { opaque, glass } = await buildCleanMesh(field16, [], this.scene, [0, 0, 0], id, getPalette())

    if (!this.wanted.has(key) || this.meshes.has(key)) {
      if (opaque.material && !isShared(opaque.material)) opaque.material.dispose()
      opaque.dispose()
      if (glass) {
        if (glass.material && !isShared(glass.material)) glass.material.dispose()
        glass.dispose()
      }
      return
    }

    opaque.name = `terrain/opaque/${key}`
    opaque.metadata = 'teleportable'
    opaque.receiveShadows = true
    opaque.position.set(cx * CHUNK_WORLD, MESH_Y, cz * CHUNK_WORLD)
    opaque.freezeWorldMatrix()

    if (glass) {
      glass.name = `terrain/water/${key}`
      glass.position.set(cx * CHUNK_WORLD, MESH_Y, cz * CHUNK_WORLD)
      glass.freezeWorldMatrix()
    }

    this.meshes.set(key, { opaque, water: glass, field: ndarray(packed, SHAPE) })

    // todo: verify collider/mesh y alignment in-game after the -0.5 shift
    const solids = solidsOnly(packed)
    const coords = await runCompute((w) => w.voxelCollider(SHAPE, solids))
    if (!this.wanted.has(key)) {
      removeCollider(`terrain-${key}`)
      return
    }
    addVoxels(`terrain-${key}`, coords, { x: cx * CHUNK_WORLD, y: WORLD_Y0, z: cz * CHUNK_WORLD })
  }
}
