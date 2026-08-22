import { Request, Response } from 'express'
import { ChainIdentifier, getChainIdByName, SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'
import cache from '../cache'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import { Db } from '../pg'

export default function (db: Db, passport: any, app: any) {
  app.get('/api/wearables/suggest', cache('5 seconds'), async (req: Request, res: Response) => {
    const bone = req.query.bone || ''
    const result = await db.query(
      'embedded/wearables-suggest',
      `select id, name, is_free from wearables
       where suppressed is not true
         and token_id is not null
       order by
         case when lower(default_bone) ilike lower($1) then 0 else 1 end,
         is_free desc, name
       limit 30`,
      [bone],
    )
    res.json({ success: true, wearables: result.rows })
  })

  app.get('/api/wearables/search', cache('5 seconds'), async (req: Request, res: Response) => {
    const q = `%${req.query.q || ''}%`
    const result = await db.query(
      'embedded/wearables-search',
      `select id, name, is_free from wearables
       where name ilike $1
         and suppressed is not true
         and token_id is not null
       order by is_free desc, name
       limit 50`,
      [q],
    )
    res.json({ success: true, wearables: result.rows })
  })

  app.get(
    '/api/collectibles.json',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectibles', 'collectibles', (req) => {
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

      return [`%${req.query.q || ''}%`, isNaN(page) ? 0 : page - 1, req.query.sort ? req.query.sort : 'updated_at', req.query.asc === 'true']
    }),
  )

  app.get(`/api/collectibles/:uuid/vox`, cache('10 minutes'), async (req: Request, res: Response) => {
    const result = await db.query('sql/get-wearable', `select data from wearables where id=$1 limit 1`, [req.params.uuid])

    const data = result.rows[0].data

    if (!data) {
      res.status(404).send({ success: false, message: 'Wearable not found' })
      return
    }

    res.set('Content-Type', 'application/octet-stream')
    res.status(200).send(data)
  })

  //get a specific collectible given collection id
  app.get(
    '/api/collections/:collection_id/collectibles/:token_id',
    cache('60 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectible', 'collectible', (req) => {
      const collection_id = parseInt(req.params.collection_id, 10)
      const token_id = parseInt(req.params.token_id, 10)
      if (isNaN(collection_id) || isNaN(token_id)) return null
      return [collection_id, token_id]
    }),
  )

  //get a specific collectible given collection address
  app.get(
    '/api/collections/:chain_identifier/:collection_address/c/:token_id.json',
    cache('60 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectible-by-chain-and-address', 'collectible', (req) => {
      const { chain_identifier, collection_address, token_id } = req.params as { chain_identifier: ChainIdentifier; collection_address: string; token_id: string }
      if (typeof SUPPORTED_CHAINS[chain_identifier] === 'undefined') {
        return [1, collection_address, token_id] // default to ethereum
      }
      if (!collection_address || !token_id) {
        return null
      }
      if (collection_address === 'undefined' || token_id === 'undefined') {
        return null
      }

      if (isNaN(Number(token_id))) {
        return null
      }

      return [getChainIdByName(chain_identifier), collection_address, token_id]
    }),
  )

  // The only time we have `/collectible` (singular)
  app.get(
    '/api/collectibles/wearable/:uuid.json',
    cache('60 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-wearable-by-uuid', 'wearable', (req) => [req.params.uuid]),
  )
}
