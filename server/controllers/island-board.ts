import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import { noCache } from '../cache'
import { createIslandPost, removeIslandPost } from '../handlers/island-board-handler'
import { ownsParcelOnIsland } from '../island-board'
import { query } from '../lib/query-helpers'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'

export default function IslandBoardController(db: Db, passport: PassportStatic, app: Express) {
  // public read; can_post tells the client whether to show the composer (per-user, so never cached)
  app.get('/api/islands/:slug/board.json', passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const slug = req.params.slug
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    noCache(res)

    if (typeof slug !== 'string' || isNaN(limit)) {
      return res.status(404).json({ success: false })
    }

    let posts: any[] = []
    try {
      const result = await query(db, 'islands/get-island-board', 'posts', [slug, limit])
      if (result.success) posts = (result as any).posts
    } catch {
      // empty island board is fine
    }

    const wallet = req.user?.wallet
    const can_post = wallet ? await ownsParcelOnIsland(wallet, slug) : false

    res.json({ success: true, posts, can_post })
  })

  app.post('/api/islands/:slug/board', passport.authenticate('jwt', { session: false }), createIslandPost)
  app.post('/api/islands/:slug/board/:id/remove', passport.authenticate('jwt', { session: false }), removeIslandPost)
}
