// ABOUTME: Postgres pool for the renderer service. Same DATABASE_URL / SSL pattern as server/pg.ts.

import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL || `postgres://localhost/voxels`
const formatted = connectionString.replace(/^postgresql:\/\//, 'postgres://')
const isLocalhost = formatted.includes('localhost') || formatted.includes('127.0.0.1')
const ssl = isLocalhost ? false : { rejectUnauthorized: false }

export const pool = new Pool({ connectionString: formatted, max: 5, ssl })

export async function loadWearableVox(id: string): Promise<Buffer | null> {
  const r = await pool.query<{ data: Buffer }>(`select data from wearables where id = $1 limit 1`, [id])
  const row = r.rows[0]
  if (!row?.data) return null
  return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data)
}
