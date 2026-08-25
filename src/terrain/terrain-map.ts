// ABOUTME: Top-down flat meshes from terrain chunks for minimap / shop map
// ABOUTME: One grey quad per chunk covering solid land bounds

import { unzlibSync } from 'fflate'
import ndarray from 'ndarray'
import { CHUNK_VOXELS, CHUNK_WORLD, TILE, chunkKey } from '../../common/terrain/constants'

export type TerrainMapMesh = {
  mesh: BABYLON.Mesh
  cx: number
  cz: number
  center: BABYLON.Vector3
  radius: number
  dispose: () => void
  distanceEnable: (playerPos: BABYLON.Vector3, loadingDistance: number) => void
  setEnabled: (on: boolean) => void
  setMaterial: (m: BABYLON.Material) => void
}

export async function fetchTerrainIndex(): Promise<Array<{ x: number; y: number; z: number }>> {
  const res = await fetch(`${process.env.ASSET_PATH || ''}/api/terrain/index.json`)
  const json = await res.json()
  return json.chunks || []
}

async function fetchPacked(cx: number, cz: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${process.env.ASSET_PATH || ''}/api/terrain/${cx}/0/${cz}.bin`)
    if (!res.ok) return null
    return unzlibSync(new Uint8Array(await res.arrayBuffer()))
  } catch {
    return null
  }
}

function landBounds(packed: Uint8Array): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  const field = ndarray(packed, [CHUNK_VOXELS, CHUNK_VOXELS, CHUNK_VOXELS])
  let minX = CHUNK_VOXELS,
    maxX = -1,
    minZ = CHUNK_VOXELS,
    maxZ = -1
  for (let lx = 0; lx < CHUNK_VOXELS; lx++) {
    for (let lz = 0; lz < CHUNK_VOXELS; lz++) {
      let land = false
      for (let y = 2; y < 16; y++) {
        const t = field.get(lx, y, lz)
        if (t === TILE.DIRT || t === TILE.GRASS) {
          land = true
          break
        }
      }
      if (!land) continue
      if (lx < minX) minX = lx
      if (lx > maxX) maxX = lx
      if (lz < minZ) minZ = lz
      if (lz > maxZ) maxZ = lz
    }
  }
  if (maxX < 0) return null
  return { minX, maxX, minZ, maxZ }
}

function topdownMesh(scene: BABYLON.Scene, parent: BABYLON.Node | null, cx: number, cz: number, packed: Uint8Array, material: BABYLON.Material): TerrainMapMesh | null {
  const b = landBounds(packed)
  if (!b) return null

  const ox = cx * CHUNK_WORLD
  const oz = cz * CHUNK_WORLD
  const x0 = ox + b.minX * 0.5
  const z0 = oz + b.minZ * 0.5
  const x1 = ox + (b.maxX + 1) * 0.5
  const z1 = oz + (b.maxZ + 1) * 0.5
  const w = x1 - x0
  const d = z1 - z0

  const mesh = BABYLON.MeshBuilder.CreateGround(`map-terrain/${chunkKey(cx, 0, cz)}`, { width: w, height: d }, scene)
  mesh.position.set((x0 + x1) / 2, 0.75, (z0 + z1) / 2)
  if (parent) mesh.parent = parent as any
  mesh.material = material
  mesh.isPickable = false

  const center = mesh.position.clone()
  const radius = Math.hypot(w, d) / 2

  return {
    mesh,
    cx,
    cz,
    center,
    radius,
    dispose: () => mesh.dispose(false, false),
    setEnabled: (on: boolean) => mesh.setEnabled(on),
    setMaterial: (m: BABYLON.Material) => {
      mesh.material = m
    },
    distanceEnable: (playerPos: BABYLON.Vector3, loadingDistance: number) => {
      const pos = playerPos.clone()
      pos.y = 0
      const a = radius + loadingDistance
      const isVisible = pos.subtract(center).lengthSquared() < a * a
      if (mesh.isEnabled() !== isVisible) mesh.setEnabled(isVisible)
    },
  }
}

export async function loadTerrainMap(scene: BABYLON.Scene, parent?: BABYLON.TransformNode, bright = false, cull = false): Promise<TerrainMapMesh[]> {
  const mat = new BABYLON.StandardMaterial('map-terrain', scene)
  mat.disableLighting = true
  const g = bright ? 0.9 : 0.2
  mat.emissiveColor.set(g, g, g)
  if (bright) mat.backFaceCulling = false
  mat.freeze()

  const index = await fetchTerrainIndex()
  const root = parent ?? null
  const out: TerrainMapMesh[] = []

  for (let i = 0; i < index.length; i += 32) {
    const batch = index.slice(i, i + 32)
    const packed = await Promise.all(batch.map((c) => fetchPacked(c.x, c.z)))
    for (let j = 0; j < batch.length; j++) {
      if (!packed[j]) continue
      const m = topdownMesh(scene, root, batch[j].x, batch[j].z, packed[j]!, mat)
      if (!m) continue
      if (!cull) m.setEnabled(true)
      else m.setEnabled(false)
      out.push(m)
    }
  }
  return out
}
