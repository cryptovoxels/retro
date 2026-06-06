import crypto from 'crypto'
import path from 'path'
import { Express, Response } from 'express'
import { SignJWT, decodeJwt } from 'jose'
import { PassportStatic } from 'passport'
import authParcel from '../auth-parcel'
import Parcel from '../parcel'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'
import { RoomServiceClient } from 'livekit-server-sdk'
import log from '../lib/logger'
import type GridSocket from '../grid/GridSocket'

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const JWT_SECRET_KEY = new TextEncoder().encode(JWT_SECRET)

// 1 hour - guest must keep the connection alive; token won't be re-issued after revoke
const GUEST_JWT_TTL_SECONDS = 60 * 60

type GuestPassRow = {
  token: string
  parcel_id: number
  feature_uuid: string
  name: string
  created_by: string
  created_at: string
  revoked_at: string | null
}

export function isGuestWallet(wallet: string | undefined | null): boolean {
  return !!wallet && wallet.startsWith('guest:')
}

function isMobileUserAgent(ua: string): boolean {
  return /mobile|android|iphone|ipad|ipod/i.test(ua)
}

function lightBroadcastPath(parcelId: number, featureUuid: string, guestPass?: string) {
  const qs = new URLSearchParams({ parcel: String(parcelId), show: featureUuid, light: '1' })
  if (guestPass) qs.set('guest_pass', guestPass)
  return `/account/go-live/broadcast?${qs.toString()}`
}

// Broadcaster session only (/live/:token -> /play). Not for audience share links.
function guestBroadcastPlayQuery(parcelLocation: string, featureUuid: string, userAgent: string): string {
  const qs = new URLSearchParams({ coords: parcelLocation, show: featureUuid, isolate: 'true', distance: 'close' })
  if (isMobileUserAgent(userAgent)) qs.set('ui', 'off')
  return qs.toString()
}

function hostJoinPlayQuery(parcelLocation: string, featureUuid: string): string {
  const qs = new URLSearchParams({ coords: parcelLocation, show: featureUuid, host: '1' })
  return qs.toString()
}

function walletFromJwtCookie(req: { cookies?: Record<string, string> }): { wallet?: string; moderator?: boolean } | null {
  const jwt = req.cookies?.jwt
  if (!jwt) return null
  try {
    const payload = decodeJwt(jwt) as { wallet?: string; moderator?: boolean; guest_pass?: string }
    if (!payload?.wallet || isGuestWallet(payload.wallet) || payload.guest_pass) return null
    return { wallet: payload.wallet, moderator: payload.moderator }
  } catch {
    return null
  }
}

export async function loadGuestPass(db: Db, token: string): Promise<GuestPassRow | null> {
  const r = await db.query('sql/guest-passes/get', `select * from guest_passes where token = $1`, [token])
  return r.rows[0] ?? null
}

function noStoreJson(res: Response, body: Record<string, unknown>) {
  res.set('Cache-Control', 'no-store')
  res.json(body)
}

export default function GuestPassesController(db: Db, passport: PassportStatic, app: Express, livekit: RoomServiceClient, gridSocket: GridSocket) {
  app.post('/api/parcels/:id/showbox-live', passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const featureUuid = String(req.body?.feature_uuid ?? '').trim()
    if (!featureUuid) return res.status(400).json({ success: false, error: 'feature_uuid required' })

    const live = !!req.body?.live

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const feature = parcel.getFeaturesByType('showbox').find((f) => f.uuid?.toLowerCase() === featureUuid.toLowerCase())
    if (!feature?.uuid) return res.status(400).json({ success: false, error: 'feature_uuid must reference a Showbox on this parcel' })

    const user = req.user as (typeof req.user & { guest_pass?: string }) | undefined
    let allowed = false
    if (user?.wallet) {
      const auth = await authParcel(parcel, user)
      if (auth === 'Owner' || auth === 'Moderator' || auth === 'Collaborator') allowed = true
    }
    if (!allowed && user?.guest_pass) {
      const pass = await loadGuestPass(db, user.guest_pass)
      if (pass && !pass.revoked_at && pass.parcel_id === parcelId && pass.feature_uuid.toLowerCase() === featureUuid.toLowerCase()) {
        allowed = true
      }
    }
    if (!allowed) return res.status(403).json({ success: false, error: 'No permission to broadcast here' })

    const patch: Record<string, unknown> = live
      ? { [feature.uuid]: { live: 1 }, __showbox_live: feature.uuid }
      : { [feature.uuid]: {}, __showbox_live: null }

    try {
      await gridSocket.publishParcelStatePatch(parcelId, patch)
      return res.json({ success: true, live })
    } catch (err) {
      log.error('[showbox-live] patch failed', { parcelId, featureUuid, error: err })
      return res.status(500).json({ success: false, error: 'Could not update showbox live state' })
    }
  })

  // List passes for a parcel - owner only
  app.get('/api/parcels/:id/guest-passes', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator') {
      return res.status(403).json({ success: false, error: 'Owner only' })
    }

    const featureUuid = String(req.query.feature_uuid ?? '').trim()
    const params: (number | string)[] = [parcelId]
    let sql = `select * from guest_passes where parcel_id = $1`
    if (featureUuid) {
      sql += ` and lower(feature_uuid) = lower($2)`
      params.push(featureUuid)
    }
    sql += ` order by created_at desc`

    const r = await db.query('sql/guest-passes/list', sql, params)
    noStoreJson(res, { success: true, passes: r.rows })
  })

  // Create a new pass - owner only
  app.post('/api/parcels/:id/guest-passes', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator') {
      return res.status(403).json({ success: false, error: 'Owner only' })
    }

    const featureUuid = String(req.body?.feature_uuid ?? '').trim()

    if (!featureUuid) return res.status(400).json({ success: false, error: 'feature_uuid required' })

    const feature = parcel.getFeaturesByType('showbox').find((f) => f.uuid?.toLowerCase() === featureUuid.toLowerCase())
    if (!feature?.uuid) {
      return res.status(400).json({ success: false, error: 'feature_uuid must reference a Showbox on this parcel' })
    }

    const existing = await db.query('sql/guest-passes/active-for-feature', `select token from guest_passes where parcel_id = $1 and lower(feature_uuid) = lower($2) and revoked_at is null limit 1`, [parcelId, feature.uuid])
    if (existing.rows[0]) {
      return res.status(400).json({ success: false, error: 'revoke the existing link first' })
    }

    const token = crypto.randomBytes(24).toString('base64url')
    const createdBy = (req.user?.wallet ?? '').toLowerCase()

    await db.query('sql/guest-passes/insert', `insert into guest_passes (token, parcel_id, feature_uuid, name, created_by) values ($1, $2, $3, '', $4)`, [token, parcelId, feature.uuid, createdBy])

    const pass = await loadGuestPass(db, token)
    res.json({ success: true, pass })
  })

  // Revoke - owner only; also kicks any live LiveKit participant for this pass
  app.delete('/api/parcels/:id/guest-passes/:token', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator') {
      return res.status(403).json({ success: false, error: 'Owner only' })
    }

    const token = decodeURIComponent(String(req.params.token ?? ''))
    const pass = await loadGuestPass(db, token)
    if (!pass || pass.parcel_id !== parcelId) {
      return res.status(404).json({ success: false, error: 'Pass not found' })
    }
    if (pass.revoked_at) {
      return noStoreJson(res, { success: true, pass, passes: [pass] })
    }

    const revoked = await db.query('sql/guest-passes/revoke-for-feature', `update guest_passes set revoked_at = now() where parcel_id = $1 and lower(feature_uuid) = lower($2) and revoked_at is null returning *`, [
      parcelId,
      pass.feature_uuid,
    ])
    const passes = revoked.rows as GuestPassRow[]
    const updated = passes.find((p) => p.token === token) ?? passes[0] ?? (await loadGuestPass(db, token))
    if (!updated?.revoked_at) {
      return res.status(500).json({ success: false, error: 'Could not revoke link' })
    }

    try {
      const roomName = `parcel-${parcelId}`
      const participants = await livekit.listParticipants(roomName)
      for (const row of passes) {
        const tokenPrefix = row.token.slice(0, 12)
        for (const p of participants) {
          if (p.identity.startsWith(`guest-${tokenPrefix}`)) {
            await livekit.removeParticipant(roomName, p.identity).catch(() => {})
          }
        }
      }
    } catch {}

    noStoreJson(res, { success: true, pass: updated, passes })
  })

  app.patch('/api/guest/:token/name', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const token = String(req.params.token)
    const user = req.user as (typeof req.user & { guest_pass?: string }) | undefined
    if (!user?.guest_pass || user.guest_pass !== token) {
      return res.status(403).json({ success: false, error: 'Not your pass' })
    }

    const pass = await loadGuestPass(db, token)
    if (!pass || pass.revoked_at) {
      return res.status(404).json({ success: false, error: 'Invalid or revoked link' })
    }

    const name = String(req.body?.name ?? '')
      .trim()
      .slice(0, 64)
    if (!name) return res.status(400).json({ success: false, error: 'name required' })

    await db.query('sql/guest-passes/update-name', `update guest_passes set name = $1 where token = $2`, [name, token])
    const syntheticWallet = `guest:${token.slice(0, 12)}`.toLowerCase()
    await db.query('sql/guest-passes/rename-avatar', `update avatars set name = $1 where owner = $2`, [name, syntheticWallet])

    res.json({ success: true, name })
  })

  app.get('/api/guest/:token', async (req, res) => {
    const pass = await loadGuestPass(db, String(req.params.token))
    if (!pass || pass.revoked_at) {
      return res.status(404).json({ success: false, error: 'Invalid or revoked link' })
    }
    const parcel = await Parcel.load(pass.parcel_id)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    res.json({
      success: true,
      parcel: { id: parcel.id, name: parcel.name, address: parcel.address, location: parcel.location },
      feature_uuid: pass.feature_uuid,
      name: pass.name,
    })
  })

  app.get('/live/:token', async (req, res) => {
    const token = String(req.params.token)
    const light = req.query.light === '1'
    try {
      const pass = await loadGuestPass(db, token)
      if (!pass || pass.revoked_at) {
        return res.status(404).send('This guest link is no longer active. Ask the parcel owner for a fresh link.')
      }

      const parcel = await Parcel.load(pass.parcel_id)
      if (!parcel) return res.status(404).send('Parcel not found')

      const ua = String(req.headers['user-agent'] ?? '')
      const signedIn = walletFromJwtCookie(req)
      if (signedIn?.wallet) {
        const auth = await authParcel(parcel, signedIn as any)
        if (auth === 'Owner' || auth === 'Moderator') {
          if (light) return res.redirect(302, lightBroadcastPath(pass.parcel_id, pass.feature_uuid))
          return res.redirect(302, `/play?${hostJoinPlayQuery(parcel.location, pass.feature_uuid)}`)
        }
        if (light) return res.redirect(302, lightBroadcastPath(pass.parcel_id, pass.feature_uuid, token))
      }

      const syntheticWallet = `guest:${token.slice(0, 12)}`.toLowerCase()

      await db.query(
        'sql/guest-passes/upsert-avatar',
        `insert into avatars (owner, name, last_online)
         values ($1, $2, now())
         on conflict (owner) do update set
           last_online = now(),
           name = case when excluded.name <> '' then excluded.name else avatars.name end`,
        [syntheticWallet, pass.name],
      )

      const jwt = await new SignJWT({
        wallet: syntheticWallet,
        guest_pass: token,
        parcel_id: pass.parcel_id,
        feature_uuid: pass.feature_uuid,
      } as any)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + GUEST_JWT_TTL_SECONDS)
        .sign(JWT_SECRET_KEY)

      res.cookie('jwt', jwt, { maxAge: GUEST_JWT_TTL_SECONDS * 1000, httpOnly: false, sameSite: 'lax' })
      if (light) return res.redirect(302, lightBroadcastPath(pass.parcel_id, pass.feature_uuid))
      const playQs = guestBroadcastPlayQuery(parcel.location, pass.feature_uuid, ua)
      res.redirect(302, `/play?${playQs}`)
    } catch (err) {
      log.error('[guest-pass] /live/:token failed', { token: token.slice(0, 12), error: err })
      res.status(500).send('Something went wrong opening this guest link. Try again in a moment or ask the parcel owner for a fresh link.')
    }
  })

  if (process.env.NODE_ENV !== 'production') {
    app.get('/dev/showbox-dock-preview', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'scripts/showbox-dock-preview.html'))
    })
  }
}
