// @ts-ignore
import bodyParser from 'body-parser'
import type { Express } from 'express'
import rateLimit from 'express-rate-limit'
import type { PassportStatic } from 'passport'
import { noCache } from '../cache'
import type { Db } from '../pg'

const ghostPostLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many ghosts, slow down.',
  statusCode: 429,
  handler: (_req, res) => {
    res.status(429).send({ success: false, error: 'Too many ghosts, slow down.' })
  },
})

const MAX_BYTES = 8 * 1024
const MIN_SAMPLES = 2
const MAX_SAMPLES = 240
const STRIDE = 16 // t,x,y,z float32

export default function GhostsController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/api/ghosts', async (req, res) => {
    const parcel = typeof req.query.parcel === 'string' ? parseInt(req.query.parcel, 10) : NaN
    if (!Number.isFinite(parcel)) {
      noCache(res)
      return res.status(400).json({ success: false })
    }

    try {
      const result = await db.query(
        'sql/ghosts/by-parcel',
        `
        SELECT start_parcel, end_parcel, type, encode(path, 'base64') AS path
        FROM ghosts
        WHERE start_parcel = $1 OR end_parcel = $1
        ORDER BY random()
        LIMIT 10
        `,
        [parcel],
      )
      noCache(res)
      return res.status(200).json({ success: true, ghosts: result.rows })
    } catch (e) {
      console.error(e)
      noCache(res)
      return res.status(400).json({ success: false })
    }
  })

  app.post('/api/ghosts', passport.authenticate(['jwt', 'anonymous'], { session: false }), ghostPostLimit, bodyParser.raw({ type: 'application/octet-stream', limit: '8kb' }), async (req, res) => {
    const startParcel = typeof req.query.start_parcel === 'string' ? parseInt(req.query.start_parcel, 10) : NaN
    const endParcel = typeof req.query.end_parcel === 'string' ? parseInt(req.query.end_parcel, 10) : NaN
    const type = typeof req.query.type === 'string' ? parseInt(req.query.type, 10) : NaN
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

    if (!Number.isFinite(startParcel) || !Number.isFinite(endParcel) || !Number.isFinite(type) || type < 0 || type > 3) {
      noCache(res)
      return res.status(400).json({ success: false })
    }
    if (body.length < MIN_SAMPLES * STRIDE || body.length > MAX_BYTES || body.length % STRIDE !== 0) {
      noCache(res)
      return res.status(400).json({ success: false })
    }
    const samples = body.length / STRIDE
    if (samples > MAX_SAMPLES) {
      noCache(res)
      return res.status(400).json({ success: false })
    }

    try {
      await db.query('sql/ghosts/insert', `INSERT INTO ghosts (start_parcel, end_parcel, type, path) VALUES ($1, $2, $3, $4)`, [startParcel, endParcel, type, body])
      noCache(res)
      return res.status(200).json({ success: true })
    } catch (e) {
      console.error(e)
      noCache(res)
      return res.status(400).json({ success: false })
    }
  })
}
