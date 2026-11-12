import type { Request, Response } from 'express'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'
import { islandEvents, islandTransaction } from '../islands'
import type { Db } from '../pg'
import { noCache } from '../cache'
import log from '../lib/logger'

const pack = promisify(gzip)
const unpack = promisify(gunzip)

export function islandGround(db: Db) {
  const grounds = new Map<number, Promise<Buffer | null>>()
  islandEvents.on('published', (id) => grounds.delete(id))
  islandEvents.on('listening', () => grounds.clear())

  async function load(id: number) {
    const { rows } = await islandTransaction(db, (client) => client.query('select ground from islands where id = $1', [id]))
    return rows[0]?.ground ? pack(rows[0].ground) : null
  }

  return async (req: Request, res: Response) => {
    noCache(res)
    const id = Number(req.params.id)
    if (!/^\d+$/.test(req.params.id) || id < 1 || id > 2147483647) return res.sendStatus(404)
    res.vary('Accept-Encoding')
    const encoding = req.acceptsEncodings('gzip', 'identity')
    if (!encoding) return res.sendStatus(406)
    const pending = grounds.get(id) ?? load(id)
    grounds.set(id, pending)
    try {
      const bytes = await pending
      if (!bytes) {
        if (grounds.get(id) === pending) grounds.delete(id)
        return res.sendStatus(404)
      }
      res.set('Cache-Control', 'public,no-cache')
      if (encoding === 'gzip') res.set('Content-Encoding', 'gzip')
      return res.type('application/octet-stream').send(encoding === 'gzip' ? bytes : await unpack(bytes))
    } catch (error) {
      if (grounds.get(id) === pending) grounds.delete(id)
      noCache(res)
      log.error('Island terrain unavailable', { id, error: String(error) })
      return res.set('Retry-After', '5').sendStatus(503)
    }
  }
}
