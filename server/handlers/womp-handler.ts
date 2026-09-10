import Womp, { WompType } from '../womp'
import { named } from '../lib/logger'
import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { Request, Response } from 'express'
import { VoxelsUserRequest } from '../user'

const log = named('womp-handler')

export async function createWomp(req: VoxelsUserRequest, res: Response) {
  const { content, coords, parcel_id, space_id, kind, image_url, metadata } = req.body
  const author = req.user?.wallet

  if (!Object.values(WompType).includes(kind)) {
    res.status(400).send({ success: false, message: 'Must specify valid kind.' })
    return
  }

  if (!author || !ethers.isAddress(author)) {
    res.status(400).send({ success: false, message: 'Bad author' })
    return
  }

  if (!coords) {
    res.status(400).send({ success: false, message: 'Invalid coordinates' })
    return
  }

  if (!parcel_id && !space_id) {
    res.status(400).send({ success: false, message: 'Invalid parcel id' })
    return
  }

  if (typeof image_url !== 'string') {
    res.status(400).send({ success: false, message: 'Image url is invalid' })
    return
  }

  if (!!space_id && (kind == WompType.Public || kind == WompType.Broadcast)) {
    res.status(400).send({ success: false, message: 'Womps in Spaces cannot be public or broadcasted' })
    return
  }

  const womp = new Womp({
    author,
    content,
    coords,
    parcel_id,
    space_id,
    image_url,
    kind,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : undefined,
  })

  const p = await womp.create()
  if (!p.success) {
    res.json({ success: false, message: p.message || 'Something went wrong', ...(p.closeUi && { closeUi: p.closeUi }) })
  } else {
    res.json({ success: true, womp_id: womp.id })
  }
}

export async function sendWompReport(req: Request, res: Response) {
  const { content, image, subtext } = req.body

  if (!process.env.SLACK_HOOK) {
    throw new Error('SLACK_HOOK env variable must be specified to use bug report.')
  }

  const body = reportPayload
  body.blocks[0].text!.text = content
  body.blocks[1].image_url = `${image}`
  body.blocks[3].elements![0].text = subtext

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    authorization: process.env.SLACK_TOKEN ?? '',
  }

  let result
  try {
    result = await fetch(process.env.SLACK_HOOK, {
      headers,
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch (e) {
    log.error('posting to slack failed', e)
    return res.status(500).json({ success: false })
  }
  const p = await result.text()
  res.json({ success: p == 'ok' })
}

/* For reporting bugs or feedback, this is a template*/
const reportPayload = {
  text: 'Bug Report!',
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '',
      },
    },
    {
      type: 'image',
      image_url: 'https://assets3.thrillist.com/v1/image/1682388/size/tl-horizontal_main.jpg',
      alt_text: 'marg',
    },
    {
      type: 'divider',
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '',
        },
      ],
    },
  ],
}
