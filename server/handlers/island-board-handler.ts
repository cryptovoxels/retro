import { ethers } from 'ethers'
import { Response } from 'express'
import db from '../pg'
import { VoxelsUserRequest } from '../user'
import IslandPost, { ownedParcelsOnIsland } from '../island-board'

// short notes read like a notice board, not a feed - and keep the one-slot rule feeling precious
const MAX_LENGTH = 240
export const ISLAND_POST_TTL = "interval '30 days'"

export async function createIslandPost(req: VoxelsUserRequest, res: Response) {
  const slug = req.params.slug
  const content = (req.body?.content ?? '').toString().trim()
  const author = req.user?.wallet

  if (!author || !ethers.isAddress(author)) {
    res.status(400).send({ success: false, message: 'Bad author' })
    return
  }

  if (!content) {
    res.status(400).send({ success: false, message: 'Empty message' })
    return
  }

  if (content.length > MAX_LENGTH) {
    res.status(400).send({ success: false, message: 'Message too long' })
    return
  }

  const myParcels = await ownedParcelsOnIsland(author, slug)
  if (!myParcels.length) {
    res.status(403).send({ success: false, message: 'Only island owners and collaborators can post here' })
    return
  }

  // optional "signed by parcel": must be one of the author's parcels on this island
  let parcelId: number | null = null
  if (req.body?.parcel_id !== undefined && req.body?.parcel_id !== null && req.body?.parcel_id !== '') {
    parcelId = parseInt(req.body.parcel_id, 10)
    if (isNaN(parcelId) || !myParcels.some((p) => p.id === parcelId)) {
      res.status(400).send({ success: false, message: 'Bad parcel signature' })
      return
    }
  }

  const post = new IslandPost({ island: slug, author, content, parcelId })
  const r = await post.create()
  if (!r.success) {
    res.json({ success: false, message: r.message || 'Something went wrong' })
  } else {
    res.json({ success: true, post_id: post.id })
  }
}

export async function removeIslandPost(req: VoxelsUserRequest, res: Response) {
  const id = parseInt(req.params.id, 10)
  const wallet = req.user?.wallet

  if (isNaN(id) || !wallet) {
    res.status(400).send({ success: false })
    return
  }

  // author can delete their own; moderators can delete any
  const del = await db.query('embedded/delete-island-post', `delete from island_posts where id = $1 and (lower(author) = lower($2) or $3) returning id`, [id, wallet, !!req.user?.moderator])

  res.json({ success: (del.rows?.length ?? 0) > 0 })
}

// one heart per wallet per note, toggleable. hearts never affect ordering, and they cascade
// away when the note is replaced or removed. signed-in wallets only - guests just read.
export async function toggleIslandPostHeart(req: VoxelsUserRequest, res: Response) {
  const id = parseInt(req.params.id, 10)
  const slug = req.params.slug
  const wallet = req.user?.wallet?.toLowerCase()

  if (isNaN(id) || !wallet || !ethers.isAddress(wallet)) {
    res.status(400).send({ success: false })
    return
  }

  const post = await db.query('embedded/island-post-heartable', `select id from island_posts where id = $1 and island = $2 and created_at > now() - ${ISLAND_POST_TTL}`, [id, slug])
  if (!(post.rows?.length ?? 0)) {
    res.status(404).send({ success: false })
    return
  }

  const del = await db.query('embedded/unheart-island-post', `delete from island_post_hearts where post_id = $1 and wallet = $2 returning post_id`, [id, wallet])
  const hearted = !(del.rows?.length ?? 0)
  if (hearted) {
    await db.query('embedded/heart-island-post', `insert into island_post_hearts (post_id, wallet) values ($1, $2) on conflict do nothing`, [id, wallet])
  }

  const count = await db.query('embedded/count-island-post-hearts', `select count(*)::int as n from island_post_hearts where post_id = $1`, [id])
  res.json({ success: true, hearted, hearts: count.rows?.[0]?.n ?? 0 })
}
