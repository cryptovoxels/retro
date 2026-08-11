import { createWomp, sendWompReport } from '../handlers/womp-handler'
import cache, { noCache } from '../cache'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import Womp from '../womp'
import { Db } from '../pg'
import { Express } from 'express'
import { PassportStatic } from 'passport'

export default function WompsController(db: Db, passport: PassportStatic, app: Express) {
  /* Womps */

  app.get('/api/womps.json', cache('5 seconds'), (req, res) => {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50

    // allow request of just "broadcast" womps
    const kinds = req.query.kind === 'broadcast' ? ['broadcast'] : ['public', 'broadcast']

    if (isNaN(limit)) {
      noCache(res)
      return res.status(404).json({ success: false, message: 'not found' })
    }
    createRequestHandlerForQuery(db, 'get-womps', 'womps', () => [limit, kinds])(req, res)
  })

  app.get('/api/womps/at/parcel/:parcelId.json', cache('60 seconds'), (req, res) => {
    const parcelId = parseInt(req.params.parcelId, 10)
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    if (isNaN(parcelId) || isNaN(limit)) {
      noCache(res)
      return res.status(404).json({ success: false, message: 'not found' })
    }
    createRequestHandlerForQuery(db, 'womps/get-womps-by-parcel', 'womps', () => [parcelId, limit])(req, res)
  })

  app.get('/api/womps/at/space/:spaceId.json', cache('60 seconds'), (req, res) => {
    const spaceId = req.params.spaceId
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    if (typeof spaceId != 'string') {
      noCache(res)
      return res.status(404).json({ success: false, message: 'not found' })
    }
    createRequestHandlerForQuery(db, 'womps/get-womps-by-space', 'womps', () => [spaceId, limit])(req, res)
  })

  app.get('/api/womps/:id.jpg', cache('immutable'), async (req, res) => {
    const wompId = parseInt(req.params.id, 10)
    if (isNaN(wompId)) {
      noCache(res)
      return res.status(404).send({ success: false, message: 'Womp not found' })
    }
    const result = await db.query('embedded/get-womp-image', 'SELECT image FROM womps WHERE id=$1', [wompId])
    const image = result?.rows[0]?.image
    if (!image) {
      noCache(res)
      return res.status(404).send({ success: false, message: 'Womp not found' })
    }
    res.set('Content-Type', 'image/jpeg')
    res.status(200).send(image)
  })

  app.get('/api/womps/:id.json', cache('immutable'), (req, res) => {
    const wompId = parseInt(req.params.id, 10)
    if (isNaN(wompId)) {
      noCache(res)
      return res.status(404).send({ success: false, message: 'Womp not found' })
    }
    createRequestHandlerForQuery(db, 'womps/get-womp', 'womp', () => [wompId])(req, res)
  })

  app.post('/api/womps/create', passport.authenticate('jwt', { session: false }), createWomp)
  app.post('/api/womps/send-report', passport.authenticate('jwt', { session: false }), sendWompReport)

  app.get('/api/womps/by/:wallet', cache('60 seconds'), async (req, res) => {
    const author = req.params.wallet
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50
    if (typeof author !== 'string' || isNaN(limit)) {
      noCache(res)
      return res.status(404).json({ success: false, message: 'not found' })
    }
    createRequestHandlerForQuery(db, 'get-womps-by-author', 'womps', () => [author, limit])(req, res)
  })

  app.get('/womps/:id/visit', cache('15 seconds'), async (req, res) => {
    const id = Number(req.params.id)
    if (isNaN(id)) {
      res.redirect('/')
      return
    }
    const womp = await Womp.loadFromId(id)

    if (!womp) {
      res.redirect('/play')
      return
    }

    if (!!womp.parcel_id) {
      res.redirect(`/play?coords=${womp.coords}`)
    } else {
      res.redirect(`/spaces/${womp.space_id}/play?coords=${womp.coords}`)
    }
  })
}
