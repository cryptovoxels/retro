import { Request, Response } from 'express'
import Avatar from '../avatar'
import { ensureAvatarExists } from '../ensure-avatar-exists'
import { isMod } from '../lib/helpers'
import { validWallet } from '../lib/isValidWallet'
import db, { pgp } from '../pg'
import { dropConnectionsForWallet } from '../server'
import { VoxelsUserRequest } from '../user'

const mpHttpUrl = (process.env.MULTIPLAYER_HOST || 'ws://localhost:3780').replace(/^ws/, 'http')
const notifyAvatarChanged = (wallet: string) =>
  fetch(`${mpHttpUrl}/api/avatar-changed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  }).catch(() => {})

function validateName(name: string): true | string {
  if (!name) return 'Name is required'
  if (name.length > 50) return 'Name is too long'
  if (name.length < 3) return 'Name is too short'
  if (!name.match(/^[a-zA-Z][a-zA-Z0-9]+$/)) return 'Name must start with a letter and can only contain letters and numbers'
  return true
}

export default function updateAvatar() {
  return async (req: VoxelsUserRequest, res: Response) => {
    const wallet = req.user?.wallet?.toLowerCase()
    if (!wallet) return res.status(403).json({ success: false })

    await ensureAvatarExists(wallet)

    if (req.body.name) {
      const existing = await db.query('embedded/get-avatar-name-for-update', `SELECT name FROM avatars WHERE lower(owner)=lower($1)`, [wallet])
      if (!existing.rows[0]?.name) {
        const validation = validateName(req.body.name)
        if (validation !== true) return res.status(400).json({ success: false, message: validation })
        const dupe = await db.query('embedded/check-name-exists', `SELECT 1 FROM avatars WHERE name ILIKE $1`, [req.body.name])
        if (dupe.rows[0]) return res.status(400).json({ success: false, message: 'Name already exists' })
        await db.query('embedded/set-avatar-name-update', `UPDATE avatars SET name=$1 WHERE lower(owner)=lower($2)`, [req.body.name, wallet])
      }
    }

    const params = {
      wallet,
      description: (req.body.description ?? '').substring(0, 500),
      social_link_1: req.body.social_link_1 ?? null,
      social_link_2: req.body.social_link_2 ?? null,
      home_id: 'home_id' in req.body ? (req.body.home_id === null ? null : parseInt(req.body.home_id, 10)) : undefined,
      settings: req.body.settings ?? null,
    }

    await pgp.none(
      `UPDATE avatars SET
        description   = $<description>,
        social_link_1 = $<social_link_1>,
        social_link_2 = $<social_link_2>,
        home_id       = $<home_id>,
        settings      = $<settings>
      WHERE lower(owner) = lower($<wallet>)`,
      params,
    )

    notifyAvatarChanged(wallet)
    res.json({ success: true })
  }
}

export async function updateAvatarAppearance(req: VoxelsUserRequest, res: Response) {
  const wallet = req.user?.wallet?.toLowerCase()
  if (!wallet) return res.status(403).json({ success: false })
  if (!('costume_id' in req.body)) return res.json({ success: true })
  await db.query('embedded/update-avatar-costume', `UPDATE avatars SET costume_id=$1 WHERE lower(owner)=lower($2)`, [req.body.costume_id, wallet])
  notifyAvatarChanged(wallet)
  res.json({ success: true })
}

export async function getAvatarSuspended(req: Request, res: Response) {
  if (!isMod(req)) {
    res.status(403).send({ success: false, message: 'Not allowed to view suspended state.' })
    return
  }

  const suspended = await Avatar.getSuspended(req.params.wallet)
  res.status(200).send({ suspended: suspended || false })
}

export async function suspendAvatar(req: Request, res: Response) {
  if (!isMod(req)) {
    res.status(403).send({ success: false, message: 'Not allowed to suspend.' })
    return
  }

  if (!validWallet(req.params.wallet)) {
    res.status(400).send({ success: false, message: 'Bad wallet.' })
    return
  }

  if (!(typeof req.body.reason === 'string' && req.body.reason.length > 0)) {
    res.status(400).send({ success: false, message: 'Must specify reason for suspension.' })
    return
  }

  const days = typeof req.body.days === 'number' ? (req.body.days as number) : 7
  const suspendedAvatar = await Avatar.suspend(req.params.wallet, req.body.reason, days)

  if (suspendedAvatar) {
    await dropConnectionsForWallet(suspendedAvatar.wallet)
  }

  res.status(200).send({ success: !!suspendedAvatar })
}

export async function unsuspendAvatar(req: Request, res: Response) {
  if (!isMod(req)) {
    res.status(403).send({ success: false, message: 'Not allowed to suspend.' })
    return
  }

  if (!validWallet(req.params.wallet)) {
    res.status(400).send({ success: false, message: 'Bad wallet.' })
    return
  }

  const result = await Avatar.unsuspend(req.params.wallet)
  res.status(200).send({ success: !!result })
}
