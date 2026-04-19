import { ethers } from 'ethers'
import { Express, NextFunction, Request, RequestHandler, Response } from 'express'
import { PassportStatic } from 'passport'
import { ChainIdentifier, getChainIdByName, SUPPORTED_CHAINS_KEYS } from '../../common/helpers/chain-helpers'
import cache, { noCache } from '../cache'
import Collection from '../collection'
import { checkValidity, createCollection, discontinueCollection, removeCollection, suppressCollection, updateAddress, updateCollection } from '../handlers/collection-handler'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import { Db, pgp } from '../pg'
import { VoxelsUserRequest } from '../user'

export default function (db: Db, passport: PassportStatic, app: Express) {
  /* Collections */
  app.get('/api/collections', cache('5 seconds'), async (req, res) => {
    if (!req.query) {
      return
    }

    const search = `%${req.query.q || ''}%`
    const sortBy = req.query.sort || 'popular'
    const limit = parseInt(req.query.limit as string) || 15
    const page = parseInt(req.query.page as string) || 0

    let orderBy = 'count(w.id) desc' // default for 'popular'

    if (sortBy === 'newest') {
      orderBy = 'c.created_at desc'
    } else if (sortBy === 'oldest') {
      orderBy = 'c.created_at asc'
    }

    const results = await pgp.any(
      `
        select
          c.id,
          c.name,
          c.description,
          c.image_url,
          c.owner,
          c.address,
          c.slug,
          c.type,
          c.chainid,
          c.settings,
          c.suppressed,
          c.rejected_at,
          c.created_at,
          count(w.id) as total_wearables
        from
          collections c
        left join
          wearables w on w.collection_id = c.id
        where
          c.name ilike $<search>
        group by
          c.id
        order by
          ${orderBy}
        limit
          coalesce($<limit>, 15)
        offset
          $<page> * coalesce($<limit>, 15)
        `,
      {
        search,
        limit,
        page,
      },
    )

    res.json({ success: true, collections: results })
  })

  app.get(
    '/api/collections/:id',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'collections/get-collection', 'collection', (req) => [req.params.id]),
  )

  app.get(
    '/api/collections/:id/collectibles',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'collectibles/get-collectibles-by-collection', 'collectibles', (req) => [req.params.id]),
  )

  app.post('/api/collections/validate', passport.authenticate('jwt', { session: false }), checkValidity)

  /** Empty collection for bulk .vox upload; wearables added per /api/assets/upload with collection_id. */
  app.post('/api/collections/upload-pack', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res) => {
    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(403).json({ success: false, message: 'Not signed in' })
      return
    }

    const name = req.body?.name
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) {
      res.status(400).json({ success: false, message: 'Name required' })
      return
    }

    try {
      var insertRes = await db.query('sql/create-collection', `insert into collections (name, description, owner) values ($1, $2, $3) returning id, chainid, slug`, [trimmed, '', wallet])
    } catch (e) {
      res.status(500).json({ success: false })
      return
    }

    const row = insertRes.rows[0] as { id: number; chainid: number | null; slug: string | null } | undefined
    if (!row?.id) {
      res.status(500).json({ success: false, message: 'Could not create collection' })
      return
    }
    const id = row.id as number
    res.json({ success: true, collection_id: id })
  })

  app.put('/api/collections/create', passport.authenticate('jwt', { session: false }), createCollection)
  app.put('/api/collections/update', passport.authenticate('jwt', { session: false }), updateCollection)
  app.put('/api/collections/update/address', passport.authenticate('jwt', { session: false }), updateAddress)
  app.put('/api/collections/remove', passport.authenticate('jwt', { session: false }), removeCollection)
  app.put('/api/collections/discontinue', passport.authenticate('jwt', { session: false }), discontinueCollection)
  app.put('/api/collections/suppress', passport.authenticate('jwt', { session: false }), suppressCollection)
}

//middleware
export const identifyCollectionParams: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const { chain_identifier, address } = req.params as { chain_identifier: ChainIdentifier; address: string }
  if (!chain_identifier && !address) {
    res.status(404).send({ success: false })
    return
  }

  if (!!chain_identifier && !SUPPORTED_CHAINS_KEYS.includes(chain_identifier)) {
    res.status(404).send({ success: false, error: 'Invalid chain identifier' })
    return
  }

  if (address && !ethers.isAddress(address)) {
    res.status(404).send({ success: false, error: 'Invalid Address' })
    return
  }
  req.params.chain_id = getChainIdByName(chain_identifier).toString()
  next()
}
