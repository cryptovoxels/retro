import { Express } from 'express'
import { ethers } from 'ethers'
import { PassportStatic } from 'passport'
import cache from '../cache'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import { Db, pgp } from '../pg'
import { VoxelsUserRequest } from '../user'

export default function (db: Db, passport: PassportStatic, app: Express) {
  app.get('/api/collections', cache('5 seconds'), async (req, res) => {
    if (!req.query) {
      return
    }

    const search = `%${req.query.q || ''}%`
    const sortBy = req.query.sort || 'popular'
    const limit = parseInt(req.query.limit as string) || 15
    const page = parseInt(req.query.page as string) || 0
    const owner = typeof req.query.owner === 'string' ? req.query.owner : null

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
          ${owner ? 'and c.owner = $<owner>' : ''}
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
        owner,
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
    createRequestHandlerForQuery(db, 'collectibles/get-collectibles-by-collection', 'collectibles', (req) => {
      const limit = parseInt(req.query.limit as string) || 256
      const page = parseInt(req.query.page as string) || 0
      // 256 was the old hard coded limit, so it stays the default and the ceiling
      return [req.params.id, Math.min(Math.max(limit, 1), 256), Math.max(page, 0)]
    }),
  )

  app.post('/api/collections', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res) => {
    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(403).json({ success: false, message: 'Not signed in' })
      return
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      res.status(400).json({ success: false, message: 'Name required' })
      return
    }

    const owns = await db.query('sql/owns-minted-parcel', `select 1 from properties where lower(owner)=lower($1) and minted=true limit 1`, [wallet])
    if (!owns.rows[0]) {
      res.status(403).json({ success: false, message: 'Need a minted parcel' })
      return
    }

    const desc = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
    try {
      var insertRes = await db.query('sql/create-collection', `insert into collections (name, description, owner, chainid, type) values ($1, $2, $3, 137, 'ERC1155') returning id`, [name, desc, wallet])
    } catch (e) {
      res.status(500).json({ success: false })
      return
    }

    const id = insertRes.rows[0]?.id
    if (!id) {
      res.status(500).json({ success: false, message: 'Could not create collection' })
      return
    }
    res.json({ success: true, collection_id: id })
  })

  app.put('/api/collections/:id', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res) => {
    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(403).json({ success: false, message: 'Not signed in' })
      return
    }

    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: 'Bad id' })
      return
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      res.status(400).json({ success: false, message: 'Name required' })
      return
    }
    const desc = typeof req.body?.description === 'string' ? req.body.description.trim() : ''

    const r = await db.query('sql/update-collection-meta', `update collections set name=$1, description=$2 where id=$3 and lower(owner)=lower($4) returning id`, [name, desc, id, wallet])
    if (!r.rows[0]) {
      res.status(403).json({ success: false, message: 'Not owner or missing' })
      return
    }
    res.json({ success: true })
  })

  app.post('/api/collections/:id/deployed', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res) => {
    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(403).json({ success: false, message: 'Not signed in' })
      return
    }

    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      res.status(400).json({ success: false, message: 'Bad id' })
      return
    }

    const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
    if (!ethers.isAddress(address)) {
      res.status(400).json({ success: false, message: 'Bad address' })
      return
    }

    const r = await db.query('sql/stamp-collection-address', `update collections set address=$1 where id=$2 and lower(owner)=lower($3) and address is null returning id`, [ethers.getAddress(address), id, wallet])
    if (!r.rows[0]) {
      res.status(403).json({ success: false, message: 'Not owner, missing, or already deployed' })
      return
    }
    res.json({ success: true, address: ethers.getAddress(address) })
  })

  app.post('/api/wearables/:uuid/minted', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res) => {
    const wallet = req.user?.wallet
    if (!wallet) {
      res.status(403).json({ success: false, message: 'Not signed in' })
      return
    }

    const uuid = req.params.uuid
    const tokenId = parseInt(req.body?.token_id, 10)
    const issues = parseInt(req.body?.issues, 10)
    if (isNaN(tokenId) || tokenId < 0) {
      res.status(400).json({ success: false, message: 'Bad token_id' })
      return
    }
    if (isNaN(issues) || issues < 1 || issues > 9) {
      res.status(400).json({ success: false, message: 'issues must be 1-9' })
      return
    }

    const row = await db.query(
      'sql/get-wearable-for-mint',
      `
      select w.id, w.token_id, w.author, c.owner as collection_owner, c.address
      from wearables w
      join collections c on c.id = w.collection_id
      where w.id=$1
      limit 1
      `,
      [uuid],
    )
    const w = row.rows[0]
    if (!w) {
      res.status(404).json({ success: false, message: 'Not found' })
      return
    }
    if (w.token_id != null) {
      res.status(400).json({ success: false, message: 'Already minted' })
      return
    }
    if (!w.address) {
      res.status(400).json({ success: false, message: 'Collection not deployed' })
      return
    }
    const allowed = (typeof w.author === 'string' && w.author.toLowerCase() === wallet.toLowerCase()) || (typeof w.collection_owner === 'string' && w.collection_owner.toLowerCase() === wallet.toLowerCase())
    if (!allowed) {
      res.status(403).json({ success: false, message: 'Not author or owner' })
      return
    }

    const upd = await db.query('sql/stamp-wearable-mint', `update wearables set token_id=$1, issues=$2, updated_at=now() where id=$3 and token_id is null returning id`, [tokenId, issues, uuid])
    if (!upd.rows[0]) {
      res.status(400).json({ success: false, message: 'Could not mint' })
      return
    }
    res.json({ success: true, token_id: tokenId, issues })
  })
}
