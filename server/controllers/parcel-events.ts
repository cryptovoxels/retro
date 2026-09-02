import { Express } from 'express'
import { PassportStatic } from 'passport'
import cache from '../cache'
import { createParcelEvent, removeParcelEvent, updateParcelEvent } from '../handlers/parcel-event-handler'
import { createRequestHandlerForQuery } from '../lib/query-helpers'
import { Db } from '../pg'

export default function (db: Db, passport: PassportStatic, app: Express) {
  // Parcel events
  app.post('/api/events/add', passport.authenticate('jwt', { session: false }), createParcelEvent)
  app.post('/api/events/update', passport.authenticate('jwt', { session: false }), updateParcelEvent)
  app.post('/api/events/remove', passport.authenticate('jwt', { session: false }), removeParcelEvent)

  app.get(
    '/api/events/on.json',
    cache('15 seconds'),
    createRequestHandlerForQuery(db, 'events/get-events-on', 'events', (req) => [req.query.live === 'true']),
  )

  app.get(
    '/api/events/on/:limit/:page.json',
    cache('15 seconds'),
    createRequestHandlerForQuery(db, 'events/get-events-on-paged', 'events', (req) => {
      const limit = typeof req.params.limit === 'string' ? parseInt(req.params.limit, 10) : NaN
      const page = typeof req.params.page === 'string' ? parseInt(req.params.page, 10) : NaN

      return [isNaN(limit) ? 3 : limit, isNaN(page) ? 0 : page]
    }),
  )

  app.get('/api/events.json', cache('5 seconds'), createRequestHandlerForQuery(db, 'events/get-events', 'events'))

  app.get(
    '/api/parcels/:id/event.json',
    cache('30 seconds'),
    createRequestHandlerForQuery(db, 'events/get-event-by-parcel', 'event', (req) => [req.params.id]),
  )

  app.get(
    '/api/events/:id.json',
    cache('30 seconds'),
    createRequestHandlerForQuery(db, 'events/get-event', 'event', (req) => [req.params.id]),
  )

  app.get(
    '/api/parcels/:id/events/history.json',
    cache('10 minutes'),
    createRequestHandlerForQuery(db, 'events/get-historic-events-by-parcel', 'events', (req) => [req.params.id]),
  )
}
