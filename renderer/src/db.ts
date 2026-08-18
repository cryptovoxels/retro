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
            lightmap_url, content, settings, sandbox, is_common, visible,
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
