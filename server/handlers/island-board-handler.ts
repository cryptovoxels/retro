import { ethers } from 'ethers'
import { Response } from 'express'
import db from '../pg'
import { VoxelsUserRequest } from '../user'
import IslandPost, { ownsParcelOnIsland } from '../island-board'

const MAX_LENGTH = 500

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

  if (!(await ownsParcelOnIsland(author, slug))) {
    res.status(403).send({ success: false, message: 'Only island landowners can post here' })
    return
  }

  const post = new IslandPost({ island: slug, author, content })
  const r = await post.create()
  if (!r.success) {
    res.json({ success: false, message: r.message || 'Something went wrong', ...(r.closeUi && { closeUi: r.closeUi }) })
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
