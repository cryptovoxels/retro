import { EventEmitter } from 'node:events'
import type { PoolClient } from 'pg'
import type { Db } from './pg'

export const islandEvents = new EventEmitter<{ published: [number]; listening: [] }>()

// Large terrain fields can take longer than the pool's 500ms statement limit.
export async function islandTransaction<T>(db: Db, run: (client: PoolClient) => Promise<T>) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '15s'")
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
