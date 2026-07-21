#!/usr/bin/env node
// Repads every parcel's voxel field from its on-chain bounds into its world
// bounds (world_* columns, set by scripts/world-bounds.mjs --apply). Existing
// voxels keep their world position; the new space is empty and buildable.
//
// Features are parented to the parcel anchor (bounds centre in xz, y1 in y),
// and the anchor moves with the new bounds, so every ungrouped feature position
// is shifted by (old anchor - new anchor). Grouped features are relative to
// their group and don't move.
//
// Run AFTER world-bounds.mjs --apply and BEFORE deploying the world-bounds
// server queries, or clients will decode old fields with new shapes.
//
// todo: old property_versions still hold old-shaped voxels/anchors; restoring
// one pre-resize version will look scrambled until it is re-saved.
// todo: lightmaps are baked against the old mesh layout; queue a rebake.
//
// Usage:
//   node scripts/resize-parcel-fields.mjs           # dry run against DATABASE_URL (default postgres://localhost/voxels)
//   node scripts/resize-parcel-fields.mjs --apply   # write resized content back

import { createHash } from 'crypto'
import { unzlibSync, zlibSync } from 'fflate'
import pg from 'pg'

const VPM = 2 // voxels per metre (VoxelSize = 0.5)

const apply = process.argv.includes('--apply')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://localhost/voxels' })
await client.connect()

const { rows } = await client.query(`
  select id, x1, x2, y1, y2, z1, z2, world_x1, world_x2, world_y1, world_y2, world_z1, world_z2, content
  from properties
  where world_x1 is not null and x1 is not null and content is not null and content::text not in ('{}', 'null')
  order by id`)
console.log(`${rows.length} parcels to check`)

let resized = 0
let skipped = 0
for (const p of rows) {
  const os = [(p.x2 - p.x1) * VPM, (p.y2 - p.y1) * VPM, (p.z2 - p.z1) * VPM]
  const ns = [(p.world_x2 - p.world_x1) * VPM, (p.world_y2 - p.world_y1) * VPM, (p.world_z2 - p.world_z1) * VPM]
  const world = [p.world_x1, p.world_y1, p.world_z1, p.world_x2, p.world_y2, p.world_z2]
  const content = p.content
  // rerunning must never shift features twice; the marker survives until the
  // next in-world save, by which point the voxel length check takes over
  if ((os[0] === ns[0] && os[1] === ns[1] && os[2] === ns[2]) || JSON.stringify(content.world) === JSON.stringify(world)) {
    skipped++
    continue
  }
  content.world = world
  if (content.voxels) {
    let old
    try {
      old = unzlibSync(Buffer.from(content.voxels, 'base64'))
    } catch {
      console.warn(`${p.id}: voxels won't inflate, skipping`)
      continue
    }
    if (old.length === ns[0] * ns[1] * ns[2] * 2) {
      skipped++ // already resized
      continue
    }
    // field is a C-order [x][y][z] Uint16Array; copy each old row into the new
    // field at the offset that keeps voxels in the same world position
    const dx = (p.x1 - p.world_x1) * VPM
    const dy = (p.y1 - p.world_y1) * VPM
    const dz = (p.z1 - p.world_z1) * VPM
    const view = new Uint16Array(old.buffer, old.byteOffset, Math.floor(old.length / 2))
    const fresh = new Uint16Array(ns[0] * ns[1] * ns[2])
    for (let x = 0; x < os[0]; x++) {
      for (let y = 0; y < os[1]; y++) {
        const from = (x * os[1] + y) * os[2]
        if (from >= view.length) break
        const row = view.subarray(from, Math.min(from + os[2], view.length))
        fresh.set(row, ((x + dx) * ns[1] + y + dy) * ns[2] + dz)
      }
    }
    content.voxels = Buffer.from(zlibSync(new Uint8Array(fresh.buffer))).toString('base64')
  }

  const shift = [(p.x1 + p.x2) / 2 - (p.world_x1 + p.world_x2) / 2, p.y1 - p.world_y1, (p.z1 + p.z2) / 2 - (p.world_z1 + p.world_z2) / 2]
  for (const f of content.features || []) {
    if (!f || f.groupId || !Array.isArray(f.position)) continue
    f.position = f.position.map((v, i) => Number(v) + shift[i])
  }

  if (apply) {
    const json = JSON.stringify(content)
    await client.query(`update properties set content = $2, memoized_hash = $3, updated_at = now() where id = $1`, [p.id, json, createHash('sha1').update(json).digest('hex')])
  }
  resized++
}

await client.end()
console.log(`${resized} resized, ${skipped} already fit${apply ? '' : ' (dry run - pass --apply to write)'}`)
