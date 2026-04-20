import { Request, Response } from 'express'
import { ChainIdentifier, getChainIdByName, SUPPORTED_CHAINS } from '../../common/helpers/chain-helpers'
import cache from '../cache'
import { createRequestHandlerForQuery, queryAndCallback } from '../lib/query-helpers'
import { parseQueryInt } from '../lib/query-parsing-helpers'
import { Db } from '../pg'

export default function (db: Db, passport: any, app: any) {
  app.get(
    '/api/collectibles.json',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectibles', 'collectibles', (req) => {
      const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

      return [`%${req.query.q || ''}%`, isNaN(page) ? 0 : page - 1, req.query.sort ? req.query.sort : 'updated_at', req.query.asc === 'true']
    }),
  )

  app.get(`/api/collectibles/:id/vox`, cache('immutable'), async (req: Request, res: Response) => {
    const wearable = await db.query('sql/get-wearable-by-id', `select * from wearables where id=$1`, [req.params.id])

    res.set('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.vox"`)
    res.status(200).send(wearable.rows[0].data)
  })

  //get a specific collectible given collection id
  app.get(
    '/api/collections/:collection_id/collectibles/:token_id',
    cache('60 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectible', 'collectible', (req) => [parseInt(req.params.collection_id, 10), req.params.token_id]),
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
  //Collection submissions

  app.post('/api/collections/collectibles/review.json', passport.authenticate('jwt', { session: false }), async (req: Request, res: Response) => {
    const limit = parseQueryInt(req.query.limit, 50)

    let q = await db.query(
      'embedded/count-collectibles-by-collection',
      `
        select count(id) as total from wearables w where w.token_id is null and suppressed = false and w.collection_id = $1
        `,
      [req.body.collection_id],
    )

    const r = !!q.rows && q.rows[0]

    if (!r) {
      res.status(200).send({ success: false })
      return
    }

    if (!r.total) {
      res.status(200).send({ success: true, collectibles: [], total: 0 })
      return
    }

    q = await db.query(
      'embedded/get-wearables-by-collection-paged',
      `
    select
      *,
      (select name from avatars where avatars.owner = w.author) as author_name
    from
      wearables w
    where
      w.token_id is null and suppressed = false and w.collection_id = $1
      limit
      $2
      offset
      coalesce(($2::integer * $3::integer),0);
    `,
      [req.body.collection_id, limit, parseQueryInt(req.query.page, 0)],
    )
    const response = !!q.rows && (q.rows as any[])

    if (!response) {
      res.status(200).send({ success: false })
      return
    }

    res.status(200).send({ success: true, collectibles: response, total: r.total })
  })

  app.post('/api/collections/collectibles/review/:wallet.json', passport.authenticate('jwt', { session: false }), async (req: Request, res: Response) => {
    const limit = parseQueryInt(req.query.limit, 50)

    let q = await db.query(
      'embedded/get-collectibles-by-wallet',
      `
        select count(id) as total from wearables w where w.token_id is null and suppressed = false and w.collection_id = $1 and lower(w.author) = lower($2);
        `,
      [req.body.collection_id, req.params.wallet],
    )

    const r = !!q.rows && q.rows[0]

    if (!r) {
      res.status(200).send({ success: false })
      return
    }

    if (!r.total) {
      res.status(200).send({ success: true, collectibles: [], total: 0 })
      return
    }

    q = await db.query(
      'embedded/get-wearables-by-wallet-2',
      `
    select
      *,
      (select name from avatars where avatars.owner = w.author) as author_name
    from
      wearables w
    where
      w.token_id is null and suppressed = false and w.collection_id = $1 and lower(w.author) = lower($2)
      limit
      $3
      offset
      coalesce(($3::integer * $4::integer),0);
    `,
      [req.body.collection_id, req.params.wallet, limit, parseQueryInt(req.query.page, 0)],
    )
    const response = !!q.rows && q.rows

    if (!response) {
      res.status(200).send({ success: false })
      return
    }
    res.status(200).send({ success: true, collectibles: response, total: r.total })
  })
}
