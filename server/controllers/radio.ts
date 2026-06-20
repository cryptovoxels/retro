import type { Express } from 'express'
import cache from '../cache'
import { Db } from '../pg'
import { buildSchedule, generateSpot, spotKind, utcDay } from '../lib/radio'

export default function RadioController(db: Db, app: Express) {
  // the day's deterministic playlist + spot markers
  app.get('/api/radio/today.json', cache('1 hour'), (req, res) => {
    res.json(buildSchedule(utcDay()))
  })

  // lazily generate (or serve cached) a DJ spot. id is "<utcDay>-<index>".
  app.get('/api/radio/spot/:id.json', async (req, res) => {
    const id = req.params.id
    const kind = spotKind(parseInt(id.split('-')[1] || '0', 10))

    try {
      const spot = await generateSpot(db, id, kind)
      res.json({ ok: true, ...spot })
    } catch (e: any) {
      console.error('radio spot failed', e?.toString())
      res.status(500).json({ ok: false })
    }
  })
}
