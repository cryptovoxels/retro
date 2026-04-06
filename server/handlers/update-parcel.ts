import assert from 'assert'
import { Request, Response } from 'express'
import authParcel from '../auth-parcel'
import log from '../lib/logger'
import Parcel from '../parcel'
import { VoxelsUserRequest } from '../user'

export default async function (req: VoxelsUserRequest, res: Response) {
  const parcel = await Parcel.load(parseInt(req.params.id, 10))

  if (!parcel) {
    res.json({ success: false, error: 'Not a valid parcel' })
    return
  }

  try {
    assert(req.body)
  } catch (e) {
    res.json({ success: false, error: 'Does not appear to be a valid update request' })
    return
  }

  if (!req.user) {
    res.json({ success: false, error: 'You do not appear to be logged in' })
    return
  }

  const authResult = await authParcel(parcel, req.user)
  const wallet = (req.user && req.user.wallet) || 'ANON'

  if (authResult) {
    if ('content' in req.body) {
      parcel.setContent(req.body.content)
    }
    if ('listed_at' in req.body) {
      parcel.refreshListedAt()
    }
  } else {
    log.warn(`authParcel with user ${wallet} cannot edit ${parcel.id}`)
    res.json({ success: false, error: 'You do not appear to be the owner or the owner of the parcel has been suspended' })
    return
  }
  let shouldUpdateMeta = false
  let shouldUpdateParcelScript = false
  if (authResult === 'Owner' || authResult === 'Moderator') {
    const updatedSettings = parcel.updateSettings(req.body)
    shouldUpdateMeta = !!updatedSettings.shouldUpdateMeta
    shouldUpdateParcelScript = !!updatedSettings.shouldUpdateParcelScript

    if ('label' in req.body) {
      parcel.updateLabel(req.body.label)
    }

    if ('parcel_users' in req.body) {
      const response = await parcel.updateParcelUsers(req.body)
      if (!response.success) {
        res.json({ success: false, error: 'Could not update parcel users' })
        return
      }
    }
  }

  if (authResult !== 'Sandbox') {
    if ('name' in req.body) {
      parcel.name = req.body.name
      shouldUpdateMeta = true
    }

    if ('description' in req.body) {
      parcel.description = req.body.description
      shouldUpdateMeta = true
    }
  } else if ('name' in req.body || 'description' in req.body) {
    res.json({ success: false, error: 'Sandbox users cannot rename parcels' })
    return
  }

  const snapshotName = req.query.snapshotName
  if (snapshotName !== undefined && typeof snapshotName !== 'string') {
    res.status(400).json({ success: false, error: 'Invalid snapshotName' })
    return
  }
  await parcel.save({ snapshotName })
  shouldUpdateMeta && parcel.broadcastMeta()
  shouldUpdateParcelScript && parcel.broadcastParcelScriptUpdate()
  res.json({ success: true })
}

export async function revertParcel(req: Request, res: Response) {
  const parcel = await Parcel.load(parseInt(req.params.id, 10))
  if (!parcel) {
    res.status(404).json({ success: false })
    return
  }
  if (typeof req.body?.parcel_version_id !== 'number') {
    res.status(404).json({ success: false })
    return
  }

  const parcelVersionId = parseInt(req.body.parcel_version_id, 10)

  if (!req.user) {
    res.json({ success: false, error: 'You do not appear to be logged in' })
    return
  }

  const authResult = await authParcel(parcel, req.user)

  if (authResult !== 'Owner') {
    res.json({ success: false, error: 'You do not appear to be the owner' })
    return
  }

  await parcel.revert(parcelVersionId)
  res.json({ success: true })
}
