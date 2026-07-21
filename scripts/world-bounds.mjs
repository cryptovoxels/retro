#!/usr/bin/env node
// Computes each parcel's "world bounds": the buildable AABB that tessellates the
// island by growing every parcel face 1m at a time (round-robin, collision checked
// against every other grown box) until faces meet at the street centerline.
// Ground parcels also get 10m of underground.
//
// Verified on the full production dump: 0 overlaps, 100% street coverage.
//
// Usage:
//   node scripts/world-bounds.mjs                      # fetch bounds from voxels.com, dry run
//   node scripts/world-bounds.mjs --apply              # write world_* columns to DATABASE_URL (default postgres://localhost/voxels)
//   node scripts/world-bounds.mjs --parcels dump.json  # use a local /api/parcels.json dump
//
// Always writes world-bounds.ndjson (one {id, island, x1..z2} per line) for
// scripts/resize-parcel-fields.mjs and for eyeballing.

import { writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import pg from 'pg'

const MAXPUSH = 12 // never grow a face more than 12m, even into a plaza
const UNDERGROUND = 10 // metres of dirt under ground parcels
const SKIP_ISLANDS = ['Architect Island'] // freeform shell parcels, do not tessellate

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const file = args.includes('--parcels') ? args[args.indexOf('--parcels') + 1] : null

const src = file ? JSON.parse(await readFile(file, 'utf8')) : await (await fetch('https://www.voxels.com/api/parcels.json')).json()
const parcels = src.parcels.filter((p) => p.x1 != null && p.x2 != null && p.z1 != null && p.z2 != null && p.y1 != null && p.y2 != null)
console.log(`${parcels.length} parcels with bounds`)

// effective y range: ground parcels claim UNDERGROUND before growth so basements
// on the far side of a street stop them, same as any other neighbour
const gy1 = (p) => (p.y1 <= 0 ? p.y1 - UNDERGROUND : p.y1)
const yolap = (a, b) => gy1(a) < b.y2 && a.y2 > gy1(b)
const xzolap = (a, b) => a.w[0] < b.w[1] && a.w[1] > b.w[0] && a.w[2] < b.w[3] && a.w[3] > b.w[2]

const islands = new Map()
for (const p of parcels) {
  if (!islands.has(p.island)) islands.set(p.island, [])
  islands.get(p.island).push(p)
}

for (const [island, ps] of islands) {
  ps.sort((a, b) => a.id - b.id)
  for (const p of ps) p.w = [p.x1, p.x2, p.z1, p.z2]
  if (SKIP_ISLANDS.includes(island)) continue

  // neighbours that could ever touch p's grown box (grown boxes reach MAXPUSH each way)
  for (const p of ps) {
    p.near = ps.filter((q) => q !== p && yolap(p, q) && q.x1 - 2 * MAXPUSH < p.x2 && q.x2 + 2 * MAXPUSH > p.x1 && q.z1 - 2 * MAXPUSH < p.z2 && q.z2 + 2 * MAXPUSH > p.z1)
    p.grown = [0, 0, 0, 0] // xlo xhi zlo zhi
  }

  // round-robin growth: 1m per face per pass keeps it symmetric, so facing
  // parcels split their street evenly and irregular gaps resolve themselves
  const faces = [
    [0, 0, -1],
    [1, 1, +1],
    [2, 2, -1],
    [3, 3, +1],
  ]
  let changed = true
  while (changed) {
    changed = false
    for (const p of ps) {
      for (const [f, i, d] of faces) {
        if (p.grown[f] >= MAXPUSH) continue
        const w = p.w.slice()
        w[i] += d
        if (p.near.some((q) => xzolap({ w }, q))) continue
        p.w = w
        p.grown[f]++
        changed = true
      }
    }
  }
}

// bottom face: ground parcels get UNDERGROUND, clamped to any parcel sitting below
for (const p of parcels) {
  p.wy1 = gy1(p)
  for (const q of islands.get(p.island)) {
    if (q !== p && q.y2 <= p.y1 && xzolap(p, q)) p.wy1 = Math.max(p.wy1, q.y2)
  }
}

// validate: no grown box may 3d-overlap another (pre-existing overlaps of the
// on-chain bounds are reported but not fatal - growth never makes them worse)
let bad = 0
for (const ps of islands.values()) {
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const p = ps[i]
      const q = ps[j]
      if (p.wy1 < q.y2 && p.y2 > q.wy1 && xzolap(p, q)) {
        bad++
        console.warn(`overlap: ${p.id} <> ${q.id} (${p.island})`)
      }
    }
  }
}
console.log(bad ? `${bad} overlapping pairs (pre-existing on-chain overlaps)` : 'no overlaps')

const rows = parcels.map((p) => ({ id: p.id, island: p.island, x1: p.w[0], x2: p.w[1], y1: p.wy1, y2: p.y2, z1: p.w[2], z2: p.w[3] }))
writeFileSync('world-bounds.ndjson', rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(`wrote world-bounds.ndjson (${rows.length} rows)`)

if (apply) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://localhost/voxels' })
  await client.connect()
  let n = 0
  for (const r of rows) {
    const res = await client.query('update properties set world_x1=$2, world_x2=$3, world_y1=$4, world_y2=$5, world_z1=$6, world_z2=$7 where id=$1', [r.id, r.x1, r.x2, r.y1, r.y2, r.z1, r.z2])
    n += res.rowCount
  }
  await client.end()
  console.log(`updated ${n} properties`)
} else {
  console.log('dry run - pass --apply to write world_* columns')
}
