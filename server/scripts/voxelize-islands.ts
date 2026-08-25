// Re-runnable island -> terrains voxelizer.
// Usage:
//   npm run voxelize              # every island
//   npm run voxelize "Andromeda"  # just that island's chunks
// Upserts every chunk that intersects an island; deletes stale rows.

import { zlibSync } from 'fflate'
import ndarray, { type NdArray } from 'ndarray'
import { CHUNK_HEIGHT_USED, CHUNK_VOXELS, CHUNK_WORLD, ISLAND_TOP_VOXEL, TILE, WATER_TOP_VOXEL, WORLD_Y0, chunkKey } from '../../common/terrain/constants'
import { VoxelSize } from '../../common/voxels/constants'
import db from '../pg'

type Ring = [number, number][]
type Poly = Ring[] // outer + holes (geojson polygon rings)
type Multi = Poly[]

const BASEMENT = new Set(['Scarcity', 'Flora', 'Andromeda'])

function pointInRing(x: number, z: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 0) + xi) inside = !inside
  }
  return inside
}

function pointInPoly(x: number, z: number, poly: Poly): boolean {
  if (!poly[0] || !pointInRing(x, z, poly[0])) return false
  for (let i = 1; i < poly.length; i++) {
    if (pointInRing(x, z, poly[i])) return false
  }
  return true
}

function pointInMulti(x: number, z: number, multi: Multi): boolean {
  for (const poly of multi) {
    if (pointInPoly(x, z, poly)) return true
  }
  return false
}

// geojson coords (*100 = world) -> world units
function scaleRing(ring: [number, number][]): Ring {
  return ring.map(([x, z]) => [x * 100, z * 100])
}

function scaleMulti(raw: any): Multi {
  if (!raw?.coordinates) return []
  return raw.coordinates.map((poly: [number, number][][]) => poly.map(scaleRing))
}

function scaleIsland(raw: any): Multi {
  if (!raw?.coordinates) return []
  // Polygon: coordinates = [ring, ...]; MultiPolygon-ish islands with id>=40 use multiple outer rings as separate polygons
  if (raw.type === 'MultiPolygon') return scaleMulti(raw)
  return [raw.coordinates.map(scaleRing)]
}

function boundsOf(multi: Multi): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (const poly of multi) {
    for (const ring of poly) {
      for (const [x, z] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
    }
  }
  if (!isFinite(minX)) return null
  return { minX, maxX, minZ, maxZ }
}

function fillOceanColumn(field: NdArray<Uint8Array>, lx: number, lz: number) {
  field.set(lx, 0, lz, TILE.SAND)
  field.set(lx, 1, lz, TILE.SAND)
  for (let y = 2; y <= WATER_TOP_VOXEL && y < CHUNK_HEIGHT_USED; y++) {
    field.set(lx, y, lz, TILE.WATER)
  }
}

function fillIslandColumn(field: NdArray<Uint8Array>, lx: number, lz: number) {
  field.set(lx, 0, lz, TILE.SAND)
  field.set(lx, 1, lz, TILE.SAND)
  for (let y = 2; y < ISLAND_TOP_VOXEL && y < CHUNK_HEIGHT_USED; y++) {
    field.set(lx, y, lz, TILE.DIRT)
  }
  if (ISLAND_TOP_VOXEL < CHUNK_HEIGHT_USED) {
    field.set(lx, ISLAND_TOP_VOXEL, lz, TILE.GRASS)
  }
}

function fillLakeColumn(field: NdArray<Uint8Array>, lx: number, lz: number) {
  // punched lake: sea floor + water, no island top
  fillOceanColumn(field, lx, lz)
}

function fillHoleColumn(field: NdArray<Uint8Array>, lx: number, lz: number) {
  // basement cutout: leave empty so parcel basements work
  field.set(lx, 0, lz, TILE.SAND)
  field.set(lx, 1, lz, TILE.SAND)
}

type IslandRow = {
  id: number
  name: string
  geometry_json: any
  lakes_geometry_json: any
  holes_geometry_json: any
}

async function main() {
  const target = process.argv[2]?.trim()

  console.log('voxelize: loading islands...')
  const { rows } = await db.query('embedded/voxelize-islands', `select id, name, geometry_json, lakes_geometry_json, holes_geometry_json from islands order by id`)

  type Island = {
    name: string
    land: Multi
    lakes: Multi
    holes: Multi
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  }

  const islands: Island[] = []
  for (const row of rows as IslandRow[]) {
    const land = scaleIsland(row.geometry_json)
    const lakes = scaleMulti(row.lakes_geometry_json)
    const holes = BASEMENT.has(row.name) ? scaleMulti(row.holes_geometry_json) : []
    const b = boundsOf(land)
    if (!b) {
      console.warn(`voxelize: skip ${row.name} (no geometry)`)
      continue
    }
    // pad bounds by a voxel so edges aren't clipped
    islands.push({
      name: row.name,
      land,
      lakes,
      holes,
      bounds: { minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1 },
    })
  }

  // the island(s) whose chunk footprint we rewrite this run
  const targets = target ? islands.filter((i) => i.name.toLowerCase() === target.toLowerCase()) : islands
  if (target && targets.length === 0) {
    console.error(`voxelize: no island named "${target}". Available: ${islands.map((i) => i.name).join(', ')}`)
    db.drain()
    process.exit(1)
  }

  // collect chunk coords covering the targeted island aabb(s)
  const chunkSet = new Map<string, { cx: number; cz: number }>()
  for (const island of targets) {
    const minCx = Math.floor(island.bounds.minX / CHUNK_WORLD)
    const maxCx = Math.floor(island.bounds.maxX / CHUNK_WORLD)
    const minCz = Math.floor(island.bounds.minZ / CHUNK_WORLD)
    const maxCz = Math.floor(island.bounds.maxZ / CHUNK_WORLD)
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        chunkSet.set(chunkKey(cx, 0, cz), { cx, cz })
      }
    }
  }

  console.log(`voxelize: ${target ? `island "${targets[0].name}"` : `${islands.length} islands`} -> ${chunkSet.size} chunks`)

  const produced: Array<{ cx: number; cz: number }> = []
  let n = 0

  const client = await db.connect()
  try {
    await client.query('begin')

    for (const { cx, cz } of chunkSet.values()) {
      const data = new Uint8Array(CHUNK_VOXELS * CHUNK_VOXELS * CHUNK_VOXELS)
      const field = ndarray(data, [CHUNK_VOXELS, CHUNK_VOXELS, CHUNK_VOXELS])
      const originX = cx * CHUNK_WORLD
      const originZ = cz * CHUNK_WORLD

      const nearby = islands.filter((i) => {
        const minCx = Math.floor(i.bounds.minX / CHUNK_WORLD)
        const maxCx = Math.floor(i.bounds.maxX / CHUNK_WORLD)
        const minCz = Math.floor(i.bounds.minZ / CHUNK_WORLD)
        const maxCz = Math.floor(i.bounds.maxZ / CHUNK_WORLD)
        return cx >= minCx && cx <= maxCx && cz >= minCz && cz <= maxCz
      })

      let hasIsland = false
      for (let lx = 0; lx < CHUNK_VOXELS; lx++) {
        for (let lz = 0; lz < CHUNK_VOXELS; lz++) {
          const wx = originX + (lx + 0.5) * VoxelSize
          const wz = originZ + (lz + 0.5) * VoxelSize

          let land = false
          let lake = false
          let hole = false
          for (const island of nearby) {
            if (pointInMulti(wx, wz, island.land)) land = true
            if (pointInMulti(wx, wz, island.lakes)) lake = true
            if (pointInMulti(wx, wz, island.holes)) hole = true
          }

          if (land && hole) {
            fillHoleColumn(field, lx, lz)
            hasIsland = true
          } else if (land && lake) {
            fillLakeColumn(field, lx, lz)
            hasIsland = true
          } else if (land) {
            fillIslandColumn(field, lx, lz)
            hasIsland = true
          } else {
            fillOceanColumn(field, lx, lz)
          }
        }
      }

      if (!hasIsland) continue

      const deflated = Buffer.from(zlibSync(data))
      await client.query(
        `insert into terrains (position, data) values (cube(array[$1::float8,$2::float8,$3::float8]), $4)
         on conflict (position) do update set data = excluded.data`,
        [cx, 0, cz, deflated],
      )
      produced.push({ cx, cz })
      n++
      if (n % 50 === 0) console.log(`voxelize: ${n} chunks...`)
    }

    const producedCubes = produced.map((p) => `(${p.cx},0,${p.cz})`)
    if (target) {
      // only prune stale chunks inside this island's footprint; leave the rest of the world alone
      const footprint = Array.from(chunkSet.values()).map((c) => `(${c.cx},0,${c.cz})`)
      await client.query(`delete from terrains where (position = any($1::cube[])) and not (position = any($2::cube[]))`, [footprint, producedCubes])
    } else if (produced.length === 0) {
      await client.query('delete from terrains')
    } else {
      await client.query(`delete from terrains where not (position = any($1::cube[]))`, [producedCubes])
    }

    await client.query('commit')
    console.log(`voxelize: done, ${produced.length} chunks upserted (y0=${WORLD_Y0})`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
    db.drain()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
