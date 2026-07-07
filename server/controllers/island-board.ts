import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import { noCache } from '../cache'
import { createIslandPost, removeIslandPost, toggleIslandPostHeart } from '../handlers/island-board-handler'
import { ownedParcelsOnIsland } from '../island-board'
import { query } from '../lib/query-helpers'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'

export default function IslandBoardController(db: Db, passport: PassportStatic, app: Express) {
  // public read; can_post/my_parcels/hearted are per-user, so never cached
  app.get('/api/islands/:slug/board.json', passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const slug = req.params.slug
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    noCache(res)

    if (typeof slug !== 'string' || isNaN(limit)) {
      return res.status(404).json({ success: false })
    }

    const wallet = req.user?.wallet?.toLowerCase() ?? ''

    let posts: any[] = []
    try {
      const result = await query(db, 'islands/get-island-board', 'posts', [slug, limit, wallet])
      if (result.success) posts = (result as any).posts
    } catch {
      // empty island board is fine
    }

    // my_parcels feeds the optional "signed by parcel" picker; owning any grants posting
    const my_parcels = wallet ? await ownedParcelsOnIsland(wallet, slug) : []

    res.json({ success: true, posts, can_post: my_parcels.length > 0, my_parcels })
  })

  app.post('/api/islands/:slug/board', passport.authenticate('jwt', { session: false }), createIslandPost)
  app.post('/api/islands/:slug/board/:id/remove', passport.authenticate('jwt', { session: false }), removeIslandPost)
  app.post('/api/islands/:slug/board/:id/heart', passport.authenticate('jwt', { session: false }), toggleIslandPostHeart)
}
