/**
 * Bake the whole Poneke island into .meke chunk files for the raycaster.
 * Reads parcels from the local dev server, writes dist/poneke/{lod}/{cx}_{cy}_{cz}.meke
 * plus index.json listing every baked chunk key. Run: npm run bake:poneke
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DIR_LEN, LOD_CHUNK_WORLD, LOD_COUNT, LOD_Y_LAYERS, MEKE_MAGIC, type Brickified } from '../src/raycast/bricks'
import { buildParcelMips, generateChunkBrickified, type ParcelMips } from '../src/raycast/gen'
import { parseParcelRecord } from '../src/raycast/parcel'

const HOST = process.env.BAKE_HOST || 'http://localhost:9000'
const OUT = path.resolve('dist/poneke')

function meke(b: Brickified): Buffer {
  const out = Buffer.alloc(8 + DIR_LEN * 4 + b.brickBytes.byteLength)
  out.writeUInt32LE(MEKE_MAGIC, 0)
  out.writeUInt32LE(b.hashes.length, 4)
  out.set(new Uint8Array(b.directory.buffer, b.directory.byteOffset, DIR_LEN * 4), 8)
  out.set(b.brickBytes, 8 + DIR_LEN * 4)
  return out
}

async function main() {
  const res = await fetch(`${HOST}/api/parcels/cached.json`)
  if (!res.ok) throw new Error(`parcels list: ${res.status} (is the dev server running on ${HOST}?)`)
  const json = (await res.json()) as { parcels?: unknown[] }
  const rows = Array.isArray(json) ? json : json.parcels
  if (!Array.isArray(rows)) throw new Error('parcels: bad payload')

  const mips: ParcelMips[] = []
  // island bounds in meters, from parcel voxel bounds (10 voxels per meter)
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity

  for (const row of rows) {
    const rec = parseParcelRecord(row)
    if (!rec) continue
    minX = Math.min(minX, rec.x1 / 10)
    maxX = Math.max(maxX, rec.x2 / 10)
    minZ = Math.min(minZ, rec.z1 / 10)
    maxZ = Math.max(maxZ, rec.z2 / 10)
    const r = await fetch(`${HOST}/grid/parcels/${rec.id}`)
    if (!r.ok) {
      console.warn(`parcel ${rec.id}: ${r.status}, skipping content`)
      continue
    }
    const parcel = ((await r.json()) as { parcel?: { voxels?: string; palette?: string[] | null } }).parcel
    if (!parcel?.voxels) continue // empty parcel: still gets baked ground below
    const o = row as { x1: number; y1: number; z1: number }
    const m = buildParcelMips(rec.id, [o.x1, o.y1, o.z1], [rec.x1, rec.y1, rec.z1], [rec.x2, rec.y2, rec.z2], parcel.voxels, parcel.palette ?? undefined)
    if (m) mips.push(m)
  }
  console.log(`poneke: ${rows.length} parcels (${mips.length} with voxels), x ${minX}..${maxX} z ${minZ}..${maxZ}`)

  rmSync(OUT, { recursive: true, force: true })
  const keys: string[] = []
  let bytes = 0

  for (let lod = 0; lod < LOD_COUNT; lod++) {
    const world = LOD_CHUNK_WORLD[lod]
    mkdirSync(path.join(OUT, String(lod)), { recursive: true })
    const x0 = Math.floor(minX / world)
    const x1 = Math.floor((maxX - 1e-6) / world)
    const z0 = Math.floor(minZ / world)
    const z1 = Math.floor((maxZ - 1e-6) / world)
    let wrote = 0
    for (let cy = 0; cy < LOD_Y_LAYERS[lod]; cy++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const b = generateChunkBrickified(lod, cx, cy, cz, mips)
          if (!b.hashes.length) continue // all air, no file
          const buf = meke(b)
          writeFileSync(path.join(OUT, String(lod), `${cx}_${cy}_${cz}.meke`), buf)
          keys.push(`${lod}:${cx}:${cy}:${cz}`)
          bytes += buf.byteLength
          wrote++
        }
      }
    }
    console.log(`lod ${lod}: ${wrote} chunks (${x1 - x0 + 1}x${LOD_Y_LAYERS[lod]}x${z1 - z0 + 1} grid)`)
  }

  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ chunks: keys }))
  console.log(`baked ${keys.length} chunks, ${(bytes / (1024 * 1024)).toFixed(1)}MB -> ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
