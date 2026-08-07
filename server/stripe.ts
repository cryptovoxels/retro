// env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_MONTH ($5), STRIPE_PRICE_YEAR ($50), APP_ORIGIN
import type { Request, Response } from 'express'
import Stripe from 'stripe'
import Avatar from './avatar'
import db from './pg'
import { isValidUUID } from './lib/helpers'

const key = () => process.env.STRIPE_SECRET_KEY || ''
const stripe = () => new Stripe(key())

const origin = () => process.env.APP_ORIGIN || 'https://www.voxels.com'

export async function ensureSpaceSponsorCols() {
  await db.query('embedded/spaces-col-until', `alter table spaces add column if not exists "until" timestamptz`, [])
  await db.query('embedded/spaces-col-by', `alter table spaces add column if not exists "by" text`, [])
  await db.query('embedded/spaces-col-sub', `alter table spaces add column if not exists sub text`, [])
}

export async function checkout(spaceId: string, who: string, yr = false) {
  if (!isValidUUID(spaceId) || !who) return null
  if (!key()) return null

  const row = await db.query('embedded/space-until', `select "until" from spaces where id=$1`, [spaceId])
  if (!row.rows[0]) return null
  if (row.rows[0].until && new Date(row.rows[0].until) > new Date()) return null

  const price = yr ? process.env.STRIPE_PRICE_YEAR : process.env.STRIPE_PRICE_MONTH
  if (!price) return null

  const name = await Avatar.getNameByWalletOrDefault(who)
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin()}/spaces/${spaceId}/play?paid=1`,
    cancel_url: `${origin()}/spaces/${spaceId}/play`,
    client_reference_id: spaceId,
    metadata: { space: spaceId, who, name },
    subscription_data: { metadata: { space: spaceId, who, name } },
  })
  return session.url
}

async function mark(space: string, by: string, sub: string, until: Date) {
  await db.query('embedded/space-mark-paid', `update spaces set "until"=$2, "by"=$3, sub=$4 where id=$1`, [space, until.toISOString(), by, sub])
}

async function lapse(sub: string) {
  await db.query('embedded/space-lapse', `update spaces set "until"=now() where sub=$1`, [sub])
}

export async function webhook(req: Request, res: Response) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !key()) {
    res.status(500).send('stripe unset')
    return
  }

  let event: Stripe.Event
  try {
    const sig = req.headers['stripe-signature'] as string
    event = stripe().webhooks.constructEvent(req.body, sig, secret)
  } catch (e) {
    console.error('stripe webhook', e)
    res.status(400).send('bad sig')
    return
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session
      const space = s.metadata?.space || s.client_reference_id
      const by = s.metadata?.name || s.metadata?.who || 'someone'
      const sub = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      if (space && sub) {
        const subObj = await stripe().subscriptions.retrieve(sub)
        const until = new Date((subObj.current_period_end || 0) * 1000)
        await mark(space, by, sub, until)
      }
    } else if (event.type === 'invoice.paid') {
      const inv = event.data.object as Stripe.Invoice
      const sub = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
      if (sub) {
        const subObj = await stripe().subscriptions.retrieve(sub)
        const space = subObj.metadata?.space
        const by = subObj.metadata?.name || subObj.metadata?.who || 'someone'
        if (space) {
          const until = new Date((subObj.current_period_end || 0) * 1000)
          await mark(space, by, sub, until)
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      if (sub.id) await lapse(sub.id)
    }
  } catch (e) {
    console.error('stripe handle', e)
    res.status(500).send('err')
    return
  }

  res.json({ ok: 1 })
}
