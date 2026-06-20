import crypto from 'crypto'
import path from 'path'
import { Express, Response } from 'express'
import { SignJWT, decodeJwt } from 'jose'
import { PassportStatic } from 'passport'
import authParcel from '../auth-parcel'
import { showboxGuestPlayCoordsFromRecord, showboxHostPlayCoordsFromRecord, showboxHostPlayQuery } from '../../common/helpers/parcel-helper'
import { FeatureRecord } from '../../common/messages/feature'
import Parcel from '../parcel'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'
import { RoomServiceClient } from 'livekit-server-sdk'
import log from '../lib/logger'
import type GridSocket from '../grid/GridSocket'
import { noCache } from '../cache'

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

// Link unfurl bots only - not in-app browsers (WhatsApp iOS often has WhatsApp/ but no Safari/).
function isLinkPreviewBot(ua: string): boolean {
  if (!ua) return false
  if (/facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|TelegramBot|LinkedInBot|Googlebot|Applebot|bingbot/i.test(ua)) return true
  if (/^WhatsApp\//i.test(ua)) return true
  if (/^curl\/|^wget\//i.test(ua)) return true
  return false
}

function lightBroadcastPath(parcelId: number, featureUuid: string, guestPass?: string, host = false) {
  const qs = new URLSearchParams({ parcel: String(parcelId), show: featureUuid, light: '1' })
  if (host) qs.set('host', '1')
  if (guestPass) qs.set('guest_pass', guestPass)
  return `/golive/broadcast?${qs.toString()}`
}

// Broadcaster session only (/live/:token -> /play). Not for audience share links.
// isolate + distance=close keep one parcel loaded; ui=off drops HUD so mobile can run live + showbox video.
function guestBroadcastPlayQuery(parcelLocation: string, featureUuid: string, userAgent: string, guestPass?: string, guestFresh = false): string {
  const qs = new URLSearchParams({ coords: parcelLocation, show: featureUuid, isolate: 'true', distance: 'close' })
  if (guestPass) qs.set('guest_pass', guestPass)
  if (guestFresh) qs.set('guest_fresh', '1')
  if (isMobileUserAgent(userAgent)) qs.set('ui', 'off')
  return qs.toString()
}

function showboxFeature(parcel: Parcel, featureUuid: string) {
  return parcel.content?.features?.find((f: FeatureRecord | null) => f?.uuid?.toLowerCase() === featureUuid.toLowerCase())
}

function showboxHostPlayCoords(parcel: Parcel, featureUuid: string): string {
  const feature = showboxFeature(parcel, featureUuid)
  if (!feature?.position) return parcel.location
  return showboxHostPlayCoordsFromRecord(parcel as any, feature)
}

function showboxGuestPlayCoords(parcel: Parcel, featureUuid: string): string {
  const feature = showboxFeature(parcel, featureUuid)
  if (!feature?.position) return parcel.location
  return showboxGuestPlayCoordsFromRecord(parcel as any, feature as any)
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

// proto TrackType is numeric (AUDIO = 0) but tolerate string representations too
function isAudioTrackInfo(t: { type?: unknown }) {
  return t?.type === 0 || String(t?.type).toUpperCase() === 'AUDIO'
}

async function kickGuestPassParticipants(livekit: RoomServiceClient, parcelId: number, passes: GuestPassRow[]) {
  if (!passes.length) return
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
  } catch {
    // room may not exist; nothing to kick
  }
}

// every visit to the link mints its own session wallet (guest:tok12.sess) so several guests
// can share ONE co-host link and still get distinct identities, names, and audio routing.
function mintGuestSessionWallet(token: string) {
  return `guest:${token.slice(0, 12)}.${crypto.randomBytes(3).toString('hex')}`.toLowerCase()
}

async function issueGuestJwt(pass: GuestPassRow, wallet: string) {
  return new SignJWT({
    wallet,
    guest_pass: pass.token,
    parcel_id: pass.parcel_id,
    feature_uuid: pass.feature_uuid,
  } as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + GUEST_JWT_TTL_SECONDS)
    .sign(JWT_SECRET_KEY)
}

export async function revokeGuestPassesForFeature(db: Db, livekit: RoomServiceClient, parcelId: number, featureUuid: string) {
  const revoked = await db.query('sql/guest-passes/revoke-for-feature', `update guest_passes set revoked_at = now() where parcel_id = $1 and lower(feature_uuid) = lower($2) and revoked_at is null returning *`, [parcelId, featureUuid])
  const passes = revoked.rows as GuestPassRow[]
  if (!passes.length) return
  await kickGuestPassParticipants(livekit, parcelId, passes)
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

    const feature = showboxFeature(parcel, featureUuid)
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

    const patch: Record<string, unknown> = live ? { [feature.uuid]: { live: 1 }, __showbox_live: feature.uuid } : { [feature.uuid]: {}, __showbox_live: null }

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
    if (auth !== 'Owner' && auth !== 'Moderator' && auth !== 'Collaborator') {
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

  // Live guests currently publishing on the parcel room, with their session names - editors only
  app.get('/api/parcels/:id/showbox-guests', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator' && auth !== 'Collaborator') {
      return res.status(403).json({ success: false, error: 'Owner only' })
    }

    const participants = await livekit.listParticipants(`parcel-${parcelId}`).catch(() => [])
    const passesRes = await db.query('sql/guest-passes/active-for-parcel', `select token from guest_passes where parcel_id = $1 and revoked_at is null`, [parcelId])
    const tokens = (passesRes.rows as { token: string }[]).map((r) => r.token)

    const guests: { identity: string; name: string; audioMuted: boolean }[] = []
    for (const p of participants) {
      if (!p.identity.startsWith('guest-') || !p.tracks?.length) continue
      // identity guest-<tok12>-<sess>-<rand> -> session wallet guest:tok12.sess -> avatar name.
      // signed-in guests (wallet-derived sess) have no session avatar; they fall back to ''.
      let name = ''
      for (const token of tokens) {
        const pre = `guest-${token.slice(0, 12)}-`
        if (!p.identity.startsWith(pre)) continue
        const sess = p.identity.slice(pre.length).split('-')[0]
        const wallet = `guest:${token.slice(0, 12)}.${sess}`.toLowerCase()
        const av = await db.query('sql/guest-passes/avatar-name', `select name from avatars where owner = $1`, [wallet])
        name = av.rows[0]?.name ?? ''
        break
      }
      const audioMuted = p.tracks.filter(isAudioTrackInfo).every((t) => t.muted)
      guests.push({ identity: p.identity, name, audioMuted })
    }
    noStoreJson(res, { success: true, guests })
  })

  // Editors can moderate a live guest: soft-mute their mic or kick the session off stage.
  // kick is not a ban - the link still works; revoke the link to ban everyone on it.
  app.post('/api/parcels/:id/showbox-moderate', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator' && auth !== 'Collaborator') {
      return res.status(403).json({ success: false, error: 'Owner only' })
    }

    const identity = String(req.body?.identity ?? '').trim()
    const action = String(req.body?.action ?? '')
    // guests only - editors can never be kicked/muted through this
    if (!identity.startsWith('guest-')) return res.status(400).json({ success: false, error: 'Can only moderate guests' })
    if (action !== 'kick' && action !== 'mute') return res.status(400).json({ success: false, error: 'action must be kick or mute' })

    const roomName = `parcel-${parcelId}`
    try {
      if (action === 'kick') {
        await livekit.removeParticipant(roomName, identity)
      } else {
        const p = await livekit.getParticipant(roomName, identity)
        for (const t of p?.tracks ?? []) {
          if (isAudioTrackInfo(t)) await livekit.mutePublishedTrack(roomName, identity, t.sid, true).catch(() => {})
        }
      }
      return noStoreJson(res, { success: true })
    } catch (err) {
      log.error('[showbox-moderate] failed', { parcelId, identity: identity.slice(0, 24), action, error: err })
      return res.status(500).json({ success: false, error: 'Could not moderate guest' })
    }
  })

  // Create a new pass - owner only
  app.post('/api/parcels/:id/guest-passes', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const parcelId = parseInt(req.params.id, 10)
    if (isNaN(parcelId)) return res.status(400).json({ success: false, error: 'Invalid parcel id' })

    const parcel = await Parcel.load(parcelId)
    if (!parcel) return res.status(404).json({ success: false, error: 'Parcel not found' })

    const auth = await authParcel(parcel, req.user ?? null)
    if (auth !== 'Owner' && auth !== 'Moderator' && auth !== 'Collaborator') {
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
    if (auth !== 'Owner' && auth !== 'Moderator' && auth !== 'Collaborator') {
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

    await kickGuestPassParticipants(livekit, parcelId, passes)

    noStoreJson(res, { success: true, pass: updated, passes })
  })

  // Re-issue guest jwt before expiry so long streams don't lose auth mid-broadcast
  app.post('/api/guest/:token/refresh', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const token = String(req.params.token)
    const user = req.user as (typeof req.user & { guest_pass?: string }) | undefined
    if (!user?.guest_pass || user.guest_pass !== token) {
      return res.status(403).json({ success: false, error: 'Not your pass' })
    }

    const pass = await loadGuestPass(db, token)
    if (!pass || pass.revoked_at) {
      return res.status(403).json({ success: false, error: 'Invalid or revoked link' })
    }

    try {
      // keep the SESSION wallet from the verified jwt - re-deriving it would merge guests
      const jwt = await issueGuestJwt(pass, String(user.wallet ?? mintGuestSessionWallet(token)).toLowerCase())
      res.cookie('jwt', jwt, { maxAge: GUEST_JWT_TTL_SECONDS * 1000, httpOnly: false, sameSite: 'lax' })
      noStoreJson(res, { success: true, jwt })
    } catch (err) {
      log.error('[guest-pass] refresh failed', { token: token.slice(0, 12), error: err })
      res.status(500).json({ success: false, error: 'Could not refresh session' })
    }
  })

  // Guest can update their own display name. Auth via the guest_pass jwt - if it doesn't match
  // the pass in the path, reject. Name lives on the synthetic avatar row only.
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

    // rename the SESSION avatar from the jwt, not the shared link wallet - with several guests
    // on one link, the old derivation renamed everyone at once
    const syntheticWallet = String(user.wallet ?? `guest:${token.slice(0, 12)}`).toLowerCase()
    try {
      // avatars.name is UNIQUE - 23505 is the Postgres unique-violation code.
      await db.query('sql/guest-passes/rename-avatar', `update avatars set name = $1 where owner = $2`, [name, syntheticWallet])
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        return res.status(409).json({ success: false, error: 'That name is taken. Pick another.' })
      }
      log.error('[guest-pass] rename failed', { token: token.slice(0, 12), error: err })
      return res.status(500).json({ success: false, error: 'Could not save name' })
    }
    res.json({ success: true, name })
  })

  // Public: lookup pass info from token (used by the live page)
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

  // Public: redeem token, set jwt cookie with synthetic guest wallet, redirect into the parcel
  app.get('/live/:token', async (req, res) => {
    const token = String(req.params.token)
    const light = req.query.light === '1'
    noCache(res)
    try {
      const pass = await loadGuestPass(db, token)
      if (!pass || pass.revoked_at) {
        return res.status(404).send('This guest link is no longer active. Ask the parcel owner for a fresh link.')
      }

      const parcel = await Parcel.load(pass.parcel_id)
      if (!parcel) return res.status(404).send('Parcel not found')

      const ua = String(req.headers['user-agent'] ?? '')
      // link unfurl bots (discord, slack, imessage) GET this url with no cookie. the anonymous
      // branch below resets the guest's name - a pasted link must not rename a live guest.
      if (isLinkPreviewBot(ua)) {
        return res.status(200).send('showbox guest link - open it in your browser to join the show')
      }
      const signedIn = walletFromJwtCookie(req)
      if (signedIn?.wallet) {
        const auth = await authParcel(parcel, signedIn as any)
        // Parcel editors host-join as themselves. Everyone else signed in keeps their account and
        // uses guest_pass in the play URL for publish permission.
        if (auth === 'Owner' || auth === 'Collaborator' || auth === 'Moderator') {
          if (light) return res.redirect(302, lightBroadcastPath(pass.parcel_id, pass.feature_uuid, undefined, true))
          return res.redirect(302, `/play?${showboxHostPlayQuery(showboxHostPlayCoords(parcel, pass.feature_uuid), pass.feature_uuid, isMobileUserAgent(ua))}`)
        }
        if (light) return res.redirect(302, lightBroadcastPath(pass.parcel_id, pass.feature_uuid, token))
        const playQs = guestBroadcastPlayQuery(showboxGuestPlayCoords(parcel, pass.feature_uuid), pass.feature_uuid, ua, token)
        return res.redirect(302, `/play?${playQs}`)
      }

      // each visit is its own guest session (own wallet/avatar/name) so the one link can host
      // several co-hosts at once. fresh row = fresh name; no recycling, no renaming a live guest.
      const syntheticWallet = mintGuestSessionWallet(token)
      await db.query(
        'sql/guest-passes/upsert-avatar',
        `insert into avatars (owner, name, last_online)
         values ($1, null, now())
         on conflict (owner) do update set
           last_online = now(),
           name = null`,
        [syntheticWallet],
      )

      const jwt = await issueGuestJwt(pass, syntheticWallet)

      res.cookie('jwt', jwt, { maxAge: GUEST_JWT_TTL_SECONDS * 1000, httpOnly: false, sameSite: 'lax' })
      if (light) {
        const lightQs = new URLSearchParams({ parcel: String(pass.parcel_id), show: pass.feature_uuid, light: '1', guest_fresh: '1' })
        return res.redirect(302, `/golive/broadcast?${lightQs.toString()}`)
      }
      const playQs = guestBroadcastPlayQuery(showboxGuestPlayCoords(parcel, pass.feature_uuid), pass.feature_uuid, ua, undefined, true)
      res.redirect(302, `/play?${playQs}`)
    } catch (err) {
      // Don't let an async throw hang the request into a proxy 503. Log the real cause and fail soft.
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
