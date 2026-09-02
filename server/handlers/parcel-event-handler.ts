import { Response } from 'express'
import { isMod } from '../lib/helpers'
import VEvent from '../parcel-event'
import { VoxelsUserRequest } from '../user'

export async function createParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { parcel_id, name, description, color, timezone, starts_at, expires_at, location } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = new VEvent({ author: req.user.wallet, parcel_id, name, description, color, location, timezone, starts_at, expires_at })

  const { valid, message } = event.isValid()
  if (!valid) return res.json({ success: false, message })

  const response = await event.create()
  res.json({ success: response.success, parcel_event: { id: event.id }, message: (response as any).message || null })
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function withinEditWindow(event: VEvent, req: VoxelsUserRequest) {
  if (isMod(req)) return true
  const created = event.created_at ? new Date(event.created_at).getTime() : 0
  return Date.now() - created < WEEK_MS
}

export async function removeParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { id } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = await VEvent.loadFromId(id)
  if (!event || (!isMod(req) && req.user.wallet.toLowerCase() !== event.author?.toLowerCase())) {
    return res.status(401).json({ success: false })
  }

  if (!withinEditWindow(event, req)) {
    return res.status(403).json({ success: false, message: 'Events can only be removed within a week of creation.' })
  }

  const response = await event.remove()
  res.json({ success: response.success })
}

export async function updateParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { id, name, description, color, timezone, starts_at, expires_at, location } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = await VEvent.loadFromId(id)
  if (!event) return res.status(404).json({ success: false })

  if (!isMod(req) && req.user.wallet.toLowerCase() !== event.author?.toLowerCase()) {
    return res.status(401).json({ success: false, message: 'Only the author can edit this event.' })
  }

  if (!withinEditWindow(event, req)) {
    return res.status(403).json({ success: false, message: 'Events can only be edited within a week of creation.' })
  }

  Object.assign(event, { name, description, color, timezone, starts_at, expires_at, location })

  const { valid, message } = event.isValid()
  if (!valid) return res.json({ success: false, message })

  const response = await event.update()
  res.json({ success: response.success, parcel_event: { id: response.id } })
}
