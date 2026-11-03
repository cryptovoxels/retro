import { readFile } from 'node:fs/promises'
import type { Request, Response } from 'express'
import type { Db } from '../pg'
import { noCache } from '../cache'
import log from '../lib/logger'

export function parcelCache(db: Db) {
  let snapshot: { success: true; parcels: any[] } | undefined
  let pending: Promise<void> | undefined
  let retryAt = 0

  async function refresh() {
    const sql = await readFile('server/queries/get-parcels-cached.sql', 'utf8')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      // One world-wide index refresh, not 20 concurrent requests with a 500ms limit.
      await client.query("SET LOCAL statement_timeout = '5s'")
      const result = await client.query(sql)
      await client.query('COMMIT')
      snapshot = { success: true, parcels: result.rows }
      retryAt = Date.now() + 60000
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  return async (_req: Request, res: Response) => {
    if (!pending && Date.now() >= retryAt) {
      pending = refresh()
        .catch((error) => {
          retryAt = Date.now() + 5000
          log.error('Parcel index refresh failed', { error: String(error) })
        })
        .finally(() => {
          pending = undefined
        })
    }
    // Keep serving the last good world while refreshing or recovering from a DB error.
    if (!snapshot) await pending
    if (snapshot) return res.json(snapshot)
    noCache(res)
    res.setHeader('Retry-After', '5')
    return res.status(503).json({ success: false })
  }
}
