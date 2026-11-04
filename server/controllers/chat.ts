import type { Express } from 'express'
import { noCache } from '../cache'
import type { Db } from '../pg'

export default function ChatController(db: Db, app: Express) {
  app.get('/api/chat.json', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : ''
    const author = typeof req.query.author === 'string' ? req.query.author.trim().toLowerCase() : ''
    try {
      const { rows } = await db.query(
        'sql/chat/recent',
        `SELECT id, uuid, text, avatar, moderated_at
         FROM chat_messages
         WHERE moderated_at IS NULL
           AND ($1 = '' OR strpos(lower(text), lower($1)) > 0)
           AND ($2 = '' OR lower(COALESCE(avatar->>'owner', avatar #>> '{}')) = $2)
         ORDER BY created_at DESC LIMIT 200`,
        [q, author],
      )
      const messages = rows.reverse().map((r: any) => ({
        id: r.id,
        uuid: r.uuid,
        text: r.text,
        avatar: r.avatar ?? undefined,
        moderated: r.moderated_at != null,
      }))
      noCache(res)
      res.status(200).json({ messages })
    } catch (e) {
      console.error(e)
      noCache(res)
      res.status(200).json({ messages: [] })
    }
  })
}
