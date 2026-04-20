import { Request, Response } from 'express'
import Avatar from '../avatar'
import { ensureAvatarExists } from '../ensure-avatar-exists'
import { isMod } from '../lib/helpers'
import { validWallet } from '../lib/isValidWallet'
import db from '../pg'
import { dropConnectionsForWallet } from '../server'
import { VoxelsUserRequest } from '../user'
import { postman } from './mails-handler'

import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

const window = new JSDOM('').window as any as Window
const DOMPurify = createDOMPurify(window as any)

function validateName(name: string): true | string {
  if (!name) {
    return 'Name is required'
  }

  if (name.length > 50) {
    return 'Name is too long'
  }

  if (name.length < 3) {
    return 'Name is too short'
  }

  // Don't allow starting with numbers
  if (!name.match(/^[a-zA-Z][a-zA-Z0-9]+$/)) {
    return 'Name must start with a letter and can only contain letters and numbers'
  }

  return true
}

export default function updateAvatar() {
  return async (req: VoxelsUserRequest, res: Response) => {
    const user = req.user
    const wallet = user?.wallet?.toLowerCase()
    if (!wallet) {
      return res.status(403).json({ success: false })
    }

    let shouldBroadcastAvatarChanged = false

    // this should be true, but might not be in certain weird cases
    await ensureAvatarExists(wallet)

    if (req.body.name) {
      const name = req.body.name

      const validation = validateName(name)

      if (validation !== true) {
        res.status(400).json({ success: false, message: validation })
        console.log('validation', validation)
        return
      }

      try {
        const checkResult = await db.query('sql/check-name-exists', `select count(*) from avatars where name ILIKE $1`, [name])

        if (checkResult.rows[0].count > 0) {
          console.log('name already exists', name)
          res.status(400).json({ success: false, message: 'Name already exists' })
          return
        }

        const r = await db.query(
          'embedded/upsert-avatar-name',
          `
          insert into
            avatars (owner, name)
          values
            ($1, $2)
          on conflict
            (owner)
          do
            update set name = excluded.name
        `,
          [wallet, name],
        )

        console.log(r)
      } catch (e) {
        console.error('Error updating avatar name', e)
        res.status(400).json({ success: false, message: 'Name already exists' })
        return
      }
    }

    if (req.body.settings) {
      await db.query('embedded/update-avatar-settings', `update avatars set settings = $1 where owner = $2`, [req.body.settings, wallet])
    }

    if ('description' in req.body) {
      if (req.body.description.length > 500) {
        req.body.description = req.body.description.substring(0, 500)
      }
      await db.query('embedded/update-avatar-description', `update avatars set description = $1 where owner = $2`, [req.body.description, wallet])
    }

    if ('social_link_1' in req.body) {
      await db.query('embedded/update-avatar-social-1', `update avatars set social_link_1 = $1 where owner = $2`, [req.body.social_link_1, wallet])
    }

    if ('social_link_2' in req.body) {
      await db.query('embedded/update-avatar-social-2', `update avatars set social_link_2 = $1 where owner = $2`, [req.body.social_link_2, wallet])
    }

    if ('costume_id' in req.body) {
      await db.query('embedded/update-avatar-costume', `update avatars set costume_id = $1 where owner = $2`, [req.body.costume_id, wallet])
      shouldBroadcastAvatarChanged = true
    }

    if ('home_id' in req.body) {
      const homeId = req.body.home_id === null ? null : parseInt(req.body.home_id, 10)
      if (homeId !== null && !isFinite(homeId)) {
        res.status(400).json({ success: false, message: 'Invalid home_id' })
        return
      }
      await db.query('embedded/update-avatar-home', `update avatars set home_id = $1 where owner = $2`, [homeId, wallet])
    }

    if (req.body.skin) {
      // Love the skin you're in (if you have skin, that is)
      const clean = DOMPurify.sanitize(req.body.skin)
      await db.query('embedded/update-avatar-skin', `update avatars set skin = $1 where owner = $2`, [clean, wallet])
      shouldBroadcastAvatarChanged = true
    }

    // if (shouldBroadcastAvatarChanged && (await publishCostumeChange(wallet)) === false) {
    //   res.status(500).send()
    //   return
    // }

    res.json({ success: true })
  }
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
    const body = {
      destinator: suspendedAvatar.wallet,
      subject: 'Your account has been suspended',
      content: `You won’t be able to build or chat with other users. Your wearables won’t be displayed in world and your avatar will appear anonymous.

        Reason:
        ${suspendedAvatar.reason}

        Expires:
        ${suspendedAvatar.expires_at}
    `,
    }
    postman(body)

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
  if (result) {
    const body = {
      destinator: result.wallet,
      subject: 'Your account has been unsuspended',
      content: `This suspension on this wallet has been removed. You will be able to build and chat again.
    `,
    }
    postman(body)
  }
  res.status(200).send({ success: !!result })
}
