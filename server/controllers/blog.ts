import { Express, Response } from 'express'
import { PassportStatic } from 'passport'
import cache, { noCache } from '../cache'
import { isAdmin, requireAdmin } from '../lib/helpers'
import { Db } from '../pg'
import { VoxelsUserRequest } from '../user'

const MAX_COMMENT = 2000

function slugify(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function BlogController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/api/posts.json', cache('1 minute'), async (_req, res: Response) => {
    try {
      const r = await db.query('embedded/list-posts', `select slug, title, body, author, created_at from posts order by created_at desc limit 10`, [])
      res.json({ success: true, posts: r.rows ?? [] })
    } catch {
      res.json({ success: true, posts: [] })
    }
  })

  app.get('/api/posts/:slug.json', passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const slug = req.params.slug
    noCache(res)
    if (typeof slug !== 'string') {
      return res.status(404).json({ success: false })
    }

    try {
      const post = await db.query(
        'embedded/get-post',
        `select p.slug, p.title, p.body, p.created_at,
          CASE
            WHEN p.author = 'voxels' THEN to_json(p.author::text)
            ELSE COALESCE(
              (SELECT row_to_json(sub) FROM (SELECT a.name, a.owner FROM avatars a WHERE lower(a.owner) = lower(p.author) LIMIT 1) sub),
              to_json(p.author)
            )
          END as author
         from posts p where p.slug = $1`,
        [slug],
      )
      if (!(post.rows?.length ?? 0)) {
        return res.status(404).json({ success: false })
      }

      const comments = await db.query(
        'embedded/get-comments',
        `select c.id, c.body, c.created_at,
          COALESCE(
            (SELECT row_to_json(sub) FROM (SELECT a.name, a.owner FROM avatars a WHERE lower(a.owner) = lower(c.owner) LIMIT 1) sub),
            to_json(c.owner)
          ) as author
         from comments c
         where c.commentable_type = 'Post' and c.commentable_id = $1
         order by c.created_at asc`,
        [slug],
      )

      res.json({ success: true, post: post.rows[0], comments: comments.rows ?? [] })
    } catch {
      res.status(404).json({ success: false })
    }
  })

  app.post('/api/posts', passport.authenticate('jwt', { session: false }), requireAdmin, async (req: VoxelsUserRequest, res: Response) => {
    const title = (req.body?.title ?? '').toString().trim()
    const body = (req.body?.body ?? '').toString().trim()
    const author = req.user?.wallet

    if (!title || !body || !author) {
      return res.status(400).json({ success: false, message: 'Need title and body' })
    }

    const slug = (req.body?.slug ?? '').toString().trim() || slugify(title)
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Bad slug' })
    }

    try {
      await db.query(
        'embedded/upsert-post',
        `insert into posts (slug, title, body, author) values ($1, $2, $3, $4)
         on conflict (slug) do update set title = excluded.title, body = excluded.body`,
        [slug, title, body, author],
      )
      res.json({ success: true, slug })
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message ?? 'fail' })
    }
  })

  app.post('/api/posts/:slug/comments', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const slug = req.params.slug
    const body = (req.body?.body ?? '').toString().trim()
    const author = req.user?.wallet

    if (!author || typeof slug !== 'string') {
      return res.status(400).json({ success: false })
    }
    if (!body) {
      return res.status(400).json({ success: false, message: 'Empty comment' })
    }
    if (body.length > MAX_COMMENT) {
      return res.status(400).json({ success: false, message: 'Comment too long' })
    }

    try {
      const post = await db.query('embedded/comment-post-exists', `select slug from posts where slug = $1`, [slug])
      if (!(post.rows?.length ?? 0)) {
        return res.status(404).json({ success: false })
      }

      const r = await db.query('embedded/insert-comment', `insert into comments (body, commentable_type, commentable_id, owner) values ($1, 'Post', $2, $3) returning id`, [body, slug, author])
      res.json({ success: true, id: r.rows?.[0]?.id })
    } catch {
      res.status(500).json({ success: false })
    }
  })

  app.post('/api/comments/:id/remove', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res: Response) => {
    const id = parseInt(req.params.id, 10)
    const wallet = req.user?.wallet

    if (isNaN(id) || !wallet) {
      return res.status(400).json({ success: false })
    }

    const del = await db.query('embedded/delete-comment', `delete from comments where id = $1 and commentable_type = 'Post' and (lower(owner) = lower($2) or $3) returning id`, [id, wallet, !!req.user?.moderator || isAdmin(req)])
    res.json({ success: (del.rows?.length ?? 0) > 0 })
  })
}
