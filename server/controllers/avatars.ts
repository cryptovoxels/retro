import { Express } from 'express'
import { encodeCoords, fetchFromMPServer } from '../../common/helpers/utils'
import cache from '../cache'
import updateAvatar, { getAvatarSuspended, suspendAvatar, unsuspendAvatar } from '../handlers/update-avatar'
import { createRequestHandlerForQuery, queryAndCallback } from '../lib/query-helpers'

import { ethers } from 'ethers'
import rateLimit from 'express-rate-limit'
import { PassportStatic } from 'passport'
import { tokensToEnter } from '../../common/messages/parcel'
import Avatar from '../avatar'
import { userOwnsToken } from '../lib/ethereum-helpers'
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
    const result = await db.query(
      'sql/avatar/assets',
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
        w.default_settings,
        c.address as collection_address,
        c.chainid as chain_id,
        c.name as collection_name
      from
        wearables w
      left join
        collections c on c.id = w.collection_id
      where
        w.author ILIKE $1
        and w.token_id is not null
        and w.suppressed is not true`,
      [wallet],
    )
    res.status(200).json({ success: true, assets: result.rows })
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
        flying: r.user.animation === 'Floating',
      })

      const url = `/play?coords=${coords}`
      res.redirect(302, url)
    } else {
      res.status(404).send('Not found')
    }
  })

  app.get('/api/avatar/:wallet/suspended', passport.authenticate('jwt', { session: false }), getAvatarSuspended)
  app.post('/api/avatar', passport.authenticate('jwt', { session: false }), updateAvatar())
  app.post('/api/avatar/:wallet/suspend', passport.authenticate('jwt', { session: false }), suspendAvatar)
  app.post('/api/avatar/:wallet/unsuspend', passport.authenticate('jwt', { session: false }), unsuspendAvatar)

  app.get('/api/avatar/:wallet/parcels-count.json', cache('15 minutes'), async (req, res) => {
    try {
      const { parcels } = await Avatar.getParcelsCount(req.params.wallet)
      res.status(200).json({ success: true, parcels })
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.toString() })
    }
  })

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

  app.get('/api/avatars-count.json', async (req, res) => {
    const result = await db.query('embedded/get-avatar-count', 'select count(owner) from avatars')
    res.status(200).send(result.rows[0].count)
  })

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
}
