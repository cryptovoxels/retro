import type { Express } from 'express'
import { noCache } from '../cache'
import type { Db } from '../pg'

export default function ChatController(db: Db, app: Express) {
  app.get('/api/chat.json', async (_req, res) => {
    try {
      const { rows } = await db.query(
        'sql/chat/recent',
        `SELECT id, uuid, text, avatar, moderated_at
         FROM chat_messages
         WHERE moderated_at IS NULL
         ORDER BY created_at DESC LIMIT 200`,
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
