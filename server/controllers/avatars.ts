import { Express } from 'express'
import { encodeCoords, fetchFromMPServer } from '../../common/helpers/utils'
import cache from '../cache'
import updateAvatar, { getAvatarSuspended, suspendAvatar, unsuspendAvatar, updateAvatarAppearance } from '../handlers/update-avatar'
import { createRequestHandlerForQuery, queryAndCallback } from '../lib/query-helpers'

import { ethers } from 'ethers'
import rateLimit from 'express-rate-limit'
import { PassportStatic } from 'passport'
import { tokensToEnter } from '../../common/messages/parcel'
import Avatar from '../avatar'
import { userOwnsToken } from '../lib/ethereum-helpers'
import { isValidUUID } from '../lib/helpers'
import { Db } from '../pg'
import { VoxelsUser } from '../user'

const apiRateLimit = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 5,
  message: 'Too many request in 30s, slow down.',
  statusCode: 429,
  handler: (req, res) => {
    res.status(429).send({
      success: false,
      error: 'Too many request in 30s, slow down.',
    })
  },
})

export default function AvatarsController(db: Db, passport: PassportStatic, app: Express) {
  // Avatars

  app.get('/api/avatars/:wallet/assets', cache('5 seconds'), async (req, res) => {
    const wallet = req.params.wallet
    if (!wallet) {
      res.status(400).json({ success: false, assets: [] })
      return
    }

    const authored = await db.query(
      'sql/avatar/assets-authored',
      `
      select
        w.id,
        w.name,
        w.description,
        w.author,
        w.issues,
        w.token_id,
        w.created_at,
        w.updated_at,
        w.hash,
        w.rejected_at,
        w.offer_prices,
        w.collection_id,
        w.custom_attributes,
        w.suppressed,
        w.category,
        w.default_bone,
        w.default_settings,
        w.is_free,
        c.address as collection_address,
        c.chainid as chain_id,
        c.name as collection_name,
        1 as quantity
      from
        wearables w
      left join
        collections c on c.id = w.collection_id
      where
        lower(w.author) = lower($1)
        and w.suppressed is not true`,
      [wallet],
    )

    const free = await db.query(
      'sql/avatar/assets-free',
      `
      select
        w.id,
        w.name,
        w.description,
        w.author,
        w.issues,
        w.token_id,
        w.created_at,
        w.updated_at,
        w.hash,
        w.rejected_at,
        w.offer_prices,
        w.collection_id,
        w.custom_attributes,
        w.suppressed,
        w.category,
        w.default_bone,
        w.default_settings,
        w.is_free,
        c.address as collection_address,
        c.chainid as chain_id,
        c.name as collection_name,
        1 as quantity
      from
        wearables w
      join
        collections c on c.id = w.collection_id
      where
        w.is_free = true
        and w.suppressed is not true
        and w.token_id is not null`,
      [],
    )

    const contracts = await db.query('sql/avatar/collection-addresses', `select address, chainid from collections where address is not null`, [])

    const byChain: Record<number, string[]> = { 1: [], 137: [] }
    for (const row of contracts.rows) {
      const chain = Number(row.chainid) || 1
      if (chain !== 1 && chain !== 137) continue
      if (typeof row.address === 'string' && ethers.isAddress(row.address)) {
        byChain[chain].push(row.address.toLowerCase())
      }
    }

    const alchemyOwned: any[] = []
    if (ethers.isAddress(wallet)) {
      for (const chain of [1, 137] as const) {
        const addrs = byChain[chain]
        if (!addrs.length) continue
        const key = chain === 1 ? process.env.ALCHEMY_ETH_API_KEY : process.env.ALCHEMY_MATIC_API_KEY
        if (!key) continue
        const host = chain === 1 ? 'eth-mainnet' : 'polygon-mainnet'
        // Alchemy caps contractAddresses at 45 per request
        for (let i = 0; i < addrs.length; i += 45) {
          const batch = addrs.slice(i, i + 45)
          const params = new URLSearchParams({ owner: wallet, withMetadata: 'false' })
          for (const a of batch) params.append('contractAddresses[]', a)
          try {
            const p = await fetch(`https://${host}.g.alchemy.com/v2/${key}/getNFTs/?${params}`)
            const j = (await p.json()) as { ownedNfts?: any[] }
            for (const nft of j.ownedNfts || []) {
              const contract = (nft.contract?.address || '').toLowerCase()
              const tokenIdRaw = nft.id?.tokenId ?? nft.tokenId
              let tokenId = NaN
              if (typeof tokenIdRaw === 'string') {
                tokenId = tokenIdRaw.startsWith('0x') ? parseInt(tokenIdRaw, 16) : parseInt(tokenIdRaw, 16)
              } else {
                tokenId = Number(tokenIdRaw)
              }
              if (!contract || isNaN(tokenId)) continue
              const qty = parseInt(String(nft.balance ?? '1'), 10) || 1
              alchemyOwned.push({ contract, tokenId, quantity: qty, chain })
            }
          } catch {
            // fail soft - authored + free still return
          }
        }
      }
    }

    const joined: any[] = []
    if (alchemyOwned.length) {
      // Join one query: all wearables with an address
      const minted = await db.query(
        'sql/avatar/assets-by-contracts',
        `
        select
          w.id,
          w.name,
          w.description,
          w.author,
          w.issues,
          w.token_id,
          w.created_at,
          w.updated_at,
          w.hash,
          w.rejected_at,
          w.offer_prices,
          w.collection_id,
          w.custom_attributes,
          w.suppressed,
          w.category,
          w.default_bone,
          w.default_settings,
          w.is_free,
          c.address as collection_address,
          c.chainid as chain_id,
          c.name as collection_name
        from wearables w
        join collections c on c.id = w.collection_id
        where w.token_id is not null
          and w.suppressed is not true
          and c.address is not null
        `,
        [],
      )
      const lookup = new Map<string, any>()
      for (const row of minted.rows) {
        lookup.set(`${String(row.collection_address).toLowerCase()}:${row.token_id}`, row)
      }
      for (const o of alchemyOwned) {
        const row = lookup.get(`${o.contract}:${o.tokenId}`)
        if (row) joined.push({ ...row, quantity: o.quantity })
      }

      // Remember the holdings so /unowned.json can answer without hitting alchemy.
      // Only when alchemy gave us something: an empty answer is a failed fetch as
      // often as it is an empty wallet, and wiping on that would flag wearables
      // people do own. Deduped because on conflict do update cannot touch the same
      // row twice in one statement.
      if (joined.length) {
        try {
          await db.query(
            'sql/avatar/track-wearable-owners',
            `with owned as (select unnest($2::uuid[]) as id), ins as (
               insert into wearable_owners (wallet, wearable_id)
               select lower($1), id from owned
               on conflict (wallet, wearable_id) do update set updated_at = now()
             )
             delete from wearable_owners where wallet = lower($1) and wearable_id not in (select id from owned)`,
            [wallet, [...new Set(joined.map((r) => r.id))]],
          )
        } catch {
          // fail soft - the assets read is the job, tracking is a side effect
        }
      }
    }

    const byKey = new Map<string, any>()
    const put = (row: any) => {
      const key = row.token_id == null ? `draft:${row.id}` : `${row.collection_id}:${row.token_id}`
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, { ...row, quantity: row.quantity ?? 1 })
        return
      }
      byKey.set(key, {
        ...prev,
        ...row,
        quantity: Math.max(prev.quantity ?? 1, row.quantity ?? 1),
        is_free: !!(prev.is_free || row.is_free),
      })
    }
    for (const row of free.rows) put(row)
    for (const row of joined) put(row)
    for (const row of authored.rows) put(row)

    res.status(200).json({ success: true, assets: [...byKey.values()] })
  })

  // Which of these wearables can this wallet not wear? Batched because the costumer
  // asks about a whole costume at once, not a piece at a time.
  app.post('/api/avatars/:wallet/unowned.json', cache(false), async (req, res) => {
    const wallet = req.params.wallet
    const wids: string[] = Array.isArray(req.body?.wids) ? req.body.wids.filter(isValidUUID).slice(0, 64) : []

    if (!ethers.isAddress(wallet) || !wids.length) {
      res.json({ success: true, unowned: [] })
      return
    }

    try {
      // Reads what /assets last wrote, so this trails the chain by one visit: something
      // bought a minute ago still reads as unowned until that route runs again. A wallet
      // with no rows at all has never been looked up, and answers nothing unowned rather
      // than telling someone to go buy a wearable they already have.
      const result = await db.query(
        'sql/avatar/unowned-wearables',
        `select w.id::text as id from wearables w
         where w.id = any($2::uuid[])
           and w.is_free is not true
           and lower(coalesce(w.author, '')) <> lower($1)
           and exists (select 1 from wearable_owners o where o.wallet = lower($1))
           and not exists (select 1 from wearable_owners o where o.wallet = lower($1) and o.wearable_id = w.id)`,
        [wallet, wids],
      )
      res.json({ success: true, unowned: result.rows.map((r) => r.id) })
    } catch {
      res.status(500).json({ success: false })
    }
  })

  app.get('/api/wearables/free.json', cache('60 seconds'), async (_req, res) => {
    const result = await db.query(
      'sql/wearables/free-wearables',
      `
      select
        w.id::text as id,
        w.name,
        w.description,
        w.author,
        w.issues,
        w.token_id,
        w.created_at,
        w.updated_at,
        w.hash,
        w.rejected_at,
        w.offer_prices,
        w.collection_id,
        w.custom_attributes,
        w.suppressed,
        w.category,
        w.default_settings,
        w.is_free,
        c.address as collection_address,
        c.chainid as chain_id,
        c.name as collection_name
      from
        wearables w
      join
        collections c on c.id = w.collection_id
      where
        w.is_free = true
        and w.suppressed is not true
        and w.token_id is not null
      order by
        w.name
      `,
      [],
    )
    res.status(200).json({ success: true, wearables: result.rows })
  })

  // Route to teleport to that avatar
  app.get('/join/:nameOrWallet', cache('5 seconds'), async (req, res) => {
    const result = await db.query(
      'embedded/get-avatar-wallet',
      `
      select
        owner as wallet
      from
        avatars
      where
        lower(owner)=lower($1) OR lower(name)=lower($1)`,
      [req.params.nameOrWallet],
    )

    if (result.rows[0]) {
      const wallet = result.rows[0].wallet
      let r
      try {
        r = await fetchFromMPServer<{ user?: any }>(`/api/user/${wallet}.json`)
      } catch (ex) {}

      if (!r || !r.user) {
        // the user isn't currently in world, redirect to profile page
        // probably could handle this better
        res.redirect(302, `/avatar/${wallet}`)
        return
      }

      const position = BABYLON.Vector3.FromArray(r.user.position)
      position.z += 1.5

      const coords = encodeCoords({
        position,
        rotation: new BABYLON.Vector3(0, Math.PI, 0),
      })

      const url = `/play?coords=${coords}`
      res.redirect(302, url)
    } else {
      res.status(404).send('Not found')
    }
  })

  app.get('/api/avatar/:wallet/suspended', passport.authenticate('jwt', { session: false }), getAvatarSuspended)
  app.post('/api/avatar', passport.authenticate('jwt', { session: false }), updateAvatar())
  app.post('/api/avatar/appearance', passport.authenticate('jwt', { session: false }), updateAvatarAppearance)
  app.post('/api/avatar/:wallet/suspend', passport.authenticate('jwt', { session: false }), suspendAvatar)
  app.post('/api/avatar/:wallet/unsuspend', passport.authenticate('jwt', { session: false }), unsuspendAvatar)

  app.post('/api/avatar/owns/:chain_identifier/:contract/:token_id', cache('1 minute'), passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
    const wallet = (req.user as Express.User & { wallet?: string })?.wallet
    if (!wallet || !ethers.isAddress(wallet)) {
      res.status(404).json({ success: false })
      return
    }

    if (!['matic', 'eth'].includes(req.params.chain_identifier)) {
      res.status(400).json({ success: false, message: 'Unsupported' })
      return
    }
    if (!req.params.contract || !ethers.isAddress(req.params.contract)) {
      res.status(404).json({ success: false })
      return
    }

    const token: tokensToEnter = {
      type: undefined!,
      chain: req.params.chain_identifier == 'eth' ? 1 : 137,
      address: req.params.contract,
      tokenId: req.params.token_id,
    }

    const doesUserOwnToken = await userOwnsToken(token, { wallet })

    res.status(200).json({ success: true, ownsToken: doesUserOwnToken })
  })

  // A GET route that is the similar to the POST route above but is rate-limited cause it's valuable
  // This is mainly used by the public, especially scripting;
  app.get('/api/avatar/owns/:chain_identifier/:contract/:token_id', apiRateLimit, cache('1 minute'), async (req, res) => {
    const wallet = req.query?.wallet
    if (!wallet || typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
      res.status(200).json({ success: false })
      return
    }

    if (!['matic', 'eth'].includes(req.params.chain_identifier)) {
      res.status(400).json({ success: false, message: 'Unsupported' })
      return
    }
    if (!req.params.contract || !ethers.isAddress(req.params.contract)) {
      res.status(404).json({ success: false })
      return
    }

    const token: tokensToEnter = {
      type: undefined!,
      chain: req.params.chain_identifier == 'eth' ? 1 : 137,
      address: req.params.contract,
      tokenId: req.params.token_id,
    }

    const doesUserOwnToken = await userOwnsToken(token, { wallet })

    res.status(200).json({ success: true, ownsToken: doesUserOwnToken })
  })

  // Used everywhere on the client to obtain the avatar
  app.get(
    '/api/avatars/:wallet.json',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'get-avatar', 'avatar', (req) => [req.params.wallet]),
  )
  // Used by avatar page (allows getting an avatar by name or wallet)
  app.get(
    '/api/avatars/by/:nameOrWallet.json',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'get-avatar-by-name-or-wallet', 'avatar', (req) => [req.params.nameOrWallet]),
  )

  app.get(
    '/api/avatars/:wallet/wearables',
    cache('5 seconds'),
    createRequestHandlerForQuery(db, 'avatars/get-avatar-costume-collectibles', 'wearables', (req) => [req.params.wallet]),
  )

  app.get(
    '/api/avatars/:wallet/costume.json',
    cache(false),
    createRequestHandlerForQuery(db, 'avatars/get-avatar-costume', 'costume', (req) => [req.params.wallet]),
  )

  app.get(
    '/api/avatar/:wallet/name.json',
    cache('30 seconds'),
    createRequestHandlerForQuery(db, 'avatars/get-name-by-wallet', 'name', (req) => [req.params.wallet]),
  )

  app.post('/api/avatars/name-by-wallets.json', cache('30 seconds'), async (req, res) => {
    const wallets = req.body.wallets

    if (!wallets) {
      res.status(400).send({ success: false })
      return
    }
    let isValid = true
    for (const wallet of wallets) {
      if (typeof wallet !== 'string') {
        isValid = false
        continue
      }
      if (!ethers.isAddress(wallet)) {
        isValid = false
      }
    }

    if (!isValid) {
      res.status(400).send({ success: false, error: 'An input is not an address' })
      return
    }

    queryAndCallback(db, 'avatars/get-name-by-wallets', 'names', [wallets], async (response) => {
      res.json(response)
    })
  })

  // Admin
  app.post('/api/avatars/is-moderator', passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
    const user = req.user as VoxelsUser | null
    const isAdmin = await Avatar.isAdmin(user?.wallet)
    const isModerator = await Avatar.isModerator(user?.wallet)
    res.json({ success: true, isAdmin: !!isAdmin, isModerator: !!isModerator })
  })

  app.get(
    '/api/avatars/:wallet/score.json',
    cache('5 minutes'),
    createRequestHandlerForQuery(db, 'avatars/get-score-by-wallet', 'scores', (req) => [req.params.wallet || '']),
  )

  app.get('/api/avatars/search', cache('10 seconds'), async (req, res) => {
    const q = (req.query.q as string) || ''
    if (!q.trim()) {
      res.json([])
      return
    }
    const like = `%${q}%`
    const result = await db.query('avatars/search', `select name, owner as wallet from avatars where lower(name) ilike lower($1) or lower(owner) ilike lower($1) limit 10`, [like])
    res.json(result.rows)
  })
}
