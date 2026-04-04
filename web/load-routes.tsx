import Avatar from './src/avatar'
import Conduct from './src/conduct'
import EventPage from './src/event-page'
import Explore from './src/explore'
import Parcel from './src/parcel'
import Parcels from './src/parcels'
import Privacy from './src/privacy'
import Space from './src/space'
import Terms from './src/terms'
import WebHeader from './src/web-header'
import Womp from './src/womp'

import * as passport from 'passport'
import cache from '../server/cache'
import renderComponent from '../server/handlers/render-component'
import { isOwner, isValidUUID } from '../server/lib/helpers'

import { queryAndCallback } from '../server/lib/query-helpers'
import db from '../server/pg'
import LoadingPage from './src/loading-page'

import { Express } from 'express'
import { SUPPORTED_CHAINS_BY_ID } from '../common/helpers/chain-helpers'
import NotFound from './src/not-found'

const renderPage = (content: any) => {
  return renderComponent(
    <div>
      <WebHeader path="/" />
      {content}
    </div>,
  )
}

export default function loadRoutes(app: Express) {
  const duration = '10 minutes'

  app.get('/', cache(duration), async (req, res) => {
    try {
      let r = await db.query(
        'sql/get-womps',
        `
      select 
        womps.id,
        womps.author,
        womps.content,
        womps.parcel_id,
        womps.image_url,
        womps.coords,
        womps.created_at,
        womps.updated_at
      from 
        womps
      order by 
        id desc 
      limit 
        32;
    `,
      )
      let womps = r.rows
      res.send(renderPage(<Explore womps={womps} />))
    } catch (e) {
      res.send(renderPage(<LoadingPage />))
    }
  })

  app.get('/explore', cache(duration), (req, res) => {
    res.send(renderPage(<Explore />))
  })

  app.get('/terms', cache(duration), (req, res) => {
    res.send(renderPage(<Terms />))
  })

  app.get('/privacy', cache(duration), (req, res) => {
    res.send(renderPage(<Privacy />))
  })

  app.get('/conduct', cache(duration), (req, res) => {
    res.send(renderPage(<Conduct />))
  })
  app.get('/not-found', cache(duration), (req, res) => {
    res.send(renderPage(<NotFound path="/not-found" />))
  })
  app.get('/parcels', cache(duration), (req, res) => {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 100) : NaN
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : NaN

    if (req.query.owner || req.query.q) {
      res.send(renderPage(<LoadingPage />))
      return
    }

    queryAndCallback(db, 'parcels/search-parcels', 'parcels', [`%${req.query.q || ''}%`, isNaN(limit) ? null : limit, isNaN(page) ? null : page, req.query.sort ? req.query.sort : 'id', true], (response) => {
      res.send(renderPage(<Parcels parcels={response.success ? response.parcels : []} />))
    })
  })

  // longish cache on the page, but only 5 second cache on the API
  // so if out of date, will update shortly after page load
  app.get('/parcels/:id', cache('10 seconds'), passport.authenticate(['jwt', 'anonymous'], { session: false }), (req, res) => {
    const id = parseInt(req.params.id, 10)

    queryAndCallback(db, 'get-parcel', 'parcel', [id, isOwner(req)], (response) => {
      if (!response.success) {
        res.status(404).json({ success: false, message: 'not found' })
        return
      }

      // if (response.parcel && response.parcel.updated_at) {
      //   const lastModified = new Date(response.parcel.updated_at)
      //   if (!isNaN(lastModified.getTime())) {
      //     res.setHeader('Last-Modified', lastModified.toUTCString())
      //   }
      // }

      res.send(renderPage(<Parcel parcel={response.parcel} />))
    })
  })

  app.get('/womps/:id', (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(404).json({ success: false, message: 'womp not found' })
    }
    queryAndCallback(db, 'womps/get-womp', 'womp', [id], (response) => {
      if (!response.success) {
        res.send(renderPage(<LoadingPage />))
        return
      }
      res.send(renderPage(<Womp womp={response.womp} id={response.womp.id} />))
    })
  })

  app.get(['/avatar/:walletOrName', '/avatar/:walletOrName/:tab?', '/u/:walletOrName', '/u/:walletOrName/:tab?'], (req, res) => {
    const walletOrName = req.params.walletOrName
    queryAndCallback(db, 'get-avatar-by-name-or-wallet', 'avatar', [walletOrName], (response) => {
      if (!response.success) {
        res.send(renderPage(<NotFound />))
        return
      }
      res.send(renderPage(<Avatar avatar={response.avatar} tab={req.params.tab} />))
    })
  })

  app.get('/events/:id', (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) {
      return res.status(404).json({ success: false, message: 'event not found' })
    }
    queryAndCallback(db, 'events/get-event', 'event', [id], (response) => {
      if (!response.success) {
        res.send(renderPage(<NotFound />))
        return
      }
      res.send(renderPage(<EventPage event={response.event} />))
    })
  })

  app.get('/collections/:collection_id/:token_id', cache('1 minute'), (req, res) => {
    const id = parseInt(req.params.collection_id, 10)
    const token_id = parseInt(req.params.token_id, 10)
    if (isNaN(token_id)) {
      return res.status(404).json({ success: false, message: 'wearable not found' })
    }
    if (isNaN(id)) {
      return res.status(404).json({ success: false, message: 'wearable not found' })
    }
    queryAndCallback(db, 'collectibles/get-collectible', 'wearable', [id, token_id], (response) => {
      if (!response.success) {
        res.redirect(404, '/not-found')
        return
      }
      const chain_identifier = SUPPORTED_CHAINS_BY_ID[response.wearable.chain_id] || 'eth'
      res.redirect(302, `/collections/${chain_identifier}/${response.wearable.collection_address}/${token_id}`)
    })
  })

  // These routes don't have any static content, are only available in the bundle
  const dynamicRoutes = [
    { path: '/admin/*', cache: '1 minute' },
    { path: '/map', cache: '1 minute' },
    { path: '/mail', cache: '1 minute' },
    { path: '/home', cache: '1 minute' },
    { path: '/account', cache: '1 minute' },
    { path: '/login', cache: '1 minute' },
    { path: '/account/:section', cache: '30 seconds' },
    { path: '/costumes/', cache: '30 seconds' },
    { path: '/assets', cache: '1 minute' },
    { path: '/assets/:id', cache: '1 minute' },
    { path: '/assets/:id/edit', cache: '1 minute' },
    { path: '/assets/:id/render', cache: '1 minute' },
    { path: '/costumer/', cache: '30 seconds' },
    { path: '/costumer/:id', cache: '30 seconds' },
    { path: '/costumes/:id/render', cache: '30 seconds' },
    { path: '/collections', cache: '30 seconds' },
    { path: '/collections/*', cache: '30 seconds' },
    { path: '/community', cache: '1 minute' },
    { path: '/spaces/new', cache: '1 minute' },
    { path: '/new', cache: '1 minute' },
    { path: '/events', cache: '1 minute' },
    { path: '/islands', cache: '1 minute' },
    { path: '/islands/:id', cache: '1 minute' },
    { path: '/parcels/:id', cache: '1 minute' },
    { path: '/avatar', cache: '1 minute' },
    { path: '/search', cache: '1 minute' },
    { path: '/womps', cache: '1 minute' },
    { path: '/metrics', cache: false },
    { path: '/spaces', cache: duration },
  ] as const

  dynamicRoutes.forEach((r) => {
    app.get(r.path, cache(r.cache), (req, res) => {
      res.send(renderPage(<LoadingPage />))
    })
  })

  app.get('/spaces/:id', cache('1 minute'), passport.authenticate(['jwt', 'anonymous'], { session: false }), (req, res) => {
    if (!req.params.id || !isValidUUID(req.params.id)) {
      return res.status(404).json({ success: false, message: 'space not found' })
    }

    queryAndCallback(db, 'spaces/get-space-content', 'space', [req.params.id], (response) => {
      if (!response.success) {
        res.redirect('/not-found')
        return
      }
      res.send(renderPage(<Space space={response.space} />))
    })
  })
}
