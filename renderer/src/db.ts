// ABOUTME: Postgres pool for the renderer service. Same DATABASE_URL / SSL pattern as server/pg.ts.

import { Pool } from 'pg'

function formatDatabaseUrl(raw: string) {
  let url = raw.replace(/^postgresql:\/\//, 'postgres://')
  // DO URLs include sslmode=require; pg v8 warns that require aliases verify-full.
  // We set ssl on the Pool explicitly instead.
  try {
    const u = new URL(url)
    u.searchParams.delete('sslmode')
    u.searchParams.delete('ssl')
    url = u.toString()
  } catch {
    // leave as-is
  }
  return url
}

const connectionString = formatDatabaseUrl(process.env.DATABASE_URL || `postgres://localhost/voxels`)
const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
const ssl = isLocalhost ? false : { rejectUnauthorized: false }

export const pool = new Pool({ connectionString, max: 5, ssl })

export async function loadWearableVox(id: string): Promise<Buffer | null> {
  const r = await pool.query<{ data: Buffer }>(`select data from wearables where id = $1 limit 1`, [id])
  const row = r.rows[0]
  if (!row?.data) return null
  return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data)
}

/** Live properties row merged into a ParcelRecord-shaped object for preview. */
export async function loadParcelRecord(id: number): Promise<Record<string, unknown> | null> {
  const r = await pool.query(
    `select id, name, label, address, description, kind, island, suburb_id,
            x1, x2, y1, y2, z1, z2, geometry_json as geometry,
            content, settings, sandbox, is_common, visible,
            (select name from suburbs where suburbs.id = properties.suburb_id) as suburb
     from properties where id = $1 limit 1`,
    [id],
  )
  const row = r.rows[0]
  if (!row) return null

  const content = row.content && typeof row.content === 'object' ? row.content : {}
  const { content: _c, suburb_id: _s, ...meta } = row
  return {
    ...meta,
    suburb: row.suburb || '',
    voxels: content.voxels || '',
    features: Array.isArray(content.features) ? content.features : [],
    tileset: content.tileset,
    palette: content.palette,
    brightness: content.brightness,
    vox: content.vox,
    settings: row.settings || {},
    owner: '',
    hash: null,
    parcel_users: [],
    distance_to_center: 0,
    distance_to_ocean: 0,
    distance_to_closest_common: 0,
    space: 0,
    height: (row.y2 ?? 0) - (row.y1 ?? 0),
  }
}

export type LotRect = { id: number; x1: number; x2: number; z1: number; z2: number }

/** Nearby visible lots for ground outlines. Self included. */
export async function loadLots(record: Record<string, unknown>): Promise<LotRect[]> {
  const x1 = Number(record.x1)
  const x2 = Number(record.x2)
  const z1 = Number(record.z1)
  const z2 = Number(record.z2)
  const w = Math.max(x2 - x1, 4) + 16
  const d = Math.max(z2 - z1, 4) + 16
  const r = await pool.query<LotRect>(
    `select id, x1, x2, z1, z2 from properties
     where visible = true and x2 > $1 and x1 < $2 and z2 > $3 and z1 < $4
     limit 200`,
    [x1 - w, x2 + w, z1 - d, z2 + d],
  )
  return r.rows
}

let islandCache: any[] | null = null

/** Archipelago shoreline data for the preview minimap. Cached for the process. */
export async function loadIslands(): Promise<any[]> {
  if (islandCache) return islandCache
  const r = await pool.query(
    `select id, name, texture,
            holes_geometry_json, lakes_geometry_json,
            geometry_json as geometry
     from islands
     order by id asc`,
  )
  islandCache = r.rows.map((row: any) => {
    if (!['Scarcity', 'Flora', 'Andromeda'].includes(row.name)) {
      row.holes_geometry_json = undefined
    }
    return row
  })
  return islandCache
}
