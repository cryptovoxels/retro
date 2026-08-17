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
