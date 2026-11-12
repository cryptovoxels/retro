import { readFile } from 'node:fs/promises'
import type { Request, Response } from 'express'
import type { Db } from '../pg'
import { islandEvents } from '../islands'
import { noCache } from '../cache'
import log from '../lib/logger'

type Snapshot = { data?: { success: true; parcels: any[] }; pending?: Promise<void>; retryAt: number }

export function parcelCache(db: Db, query = 'get-parcels-cached') {
  let current: Snapshot = { retryAt: 0 }
  const clear = () => {
    current = { retryAt: 0 }
  }
  islandEvents.on('published', clear)
  islandEvents.on('listening', clear)

  async function refresh(state: Snapshot) {
    const sql = await readFile(`server/queries/${query}.sql`, 'utf8')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      // One world-wide index refresh, not 20 concurrent requests with a 500ms limit.
      await client.query("SET LOCAL statement_timeout = '5s'")
      const result = await client.query(sql)
      await client.query('COMMIT')
      state.data = { success: true, parcels: result.rows }
      state.retryAt = Date.now() + 60000
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  return async (_req: Request, res: Response) => {
    const state = current
    if (!state.pending && Date.now() >= state.retryAt) {
      state.pending = refresh(state)
        .catch((error) => {
          state.retryAt = Date.now() + 5000
          log.error('Parcel index refresh failed', { error: String(error) })
        })
        .finally(() => {
          state.pending = undefined
        })
    }
    // Keep serving the last good world while refreshing or recovering from a DB error.
    if (!state.data) await state.pending
    if (state.data) return res.json(state.data)
    noCache(res)
    res.setHeader('Retry-After', '5')
    return res.status(503).json({ success: false })
  }
}
