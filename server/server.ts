import fs from 'fs'
import http from 'http'
import https from 'https'
import 'source-map-support/register'
import Parcel, { PARCEL_EVENT_EMITTER } from './parcel'

// Import handlers
import BuildRequestHandler, { SpaceBuildRequestHandler } from './handlers/build-parcel'
import queryParcel, { refreshParcelsByWallet } from './handlers/query-parcel'
import { EmailCode, SignIn } from './handlers/sign-in'
import { PasskeyAvailable, PasskeyLoginOptions, PasskeyLoginVerify, PasskeyRegisterOptions, PasskeyRegisterVerify } from './handlers/passkey'
import updateParcel from './handlers/update-parcel'

import { currentVersion } from '../common/version'
import Avatar from './avatar'
import sitemap from './handlers/sitemap'
import streamWearable from './handlers/stream-wearable'
import { isOwner } from './lib/helpers'

import AdminController from './controllers/admin'
import ScratchpadController from './controllers/scratchpad'
import CollectiblesController from './controllers/collectibles'
import CollectionsController from './controllers/collections'
import EmojiBadgeController from './controllers/emoji_badges'
import FavoritesController from './controllers/favorites'
import LivekitController from './controllers/livekit'
import NftController from './controllers/nft'
import EventsController from './controllers/parcel-events'
import ParcelsController from './controllers/parcels'
import PlayController from './controllers/play'
import SpacesController from './controllers/spaces'
import MetricsController from './controllers/metrics'

import cache, { defaultCache, noCache } from './cache'
import db, { pgp } from './pg'

import { ethers } from 'ethers'
import type { Express, Request, Response } from 'express'
import express from 'express'
import basicAuth from 'express-basic-auth'
import proxy from 'express-http-proxy'
import rateLimit from 'express-rate-limit'
import expressStaticGzip from 'express-static-gzip'
import { Strategy as AnonymousStrategy } from 'passport-anonymous'
import AssetLibraryController from './controllers/assets'
import AvatarsController from './controllers/avatars'
import CostumesController from './controllers/costumes'
import ExternalsController from './controllers/externals'
import MailsController from './controllers/mails'
import ModerationReportsController from './controllers/reports'
import WompsController from './controllers/womps'
import createGridSocket from './grid/createGridSocket'
import { searchAndReturn } from './handlers/search'
import { EthereumListener } from './jobs/ethereum-listener'
import cleanCollections from './jobs/remove-collections'
import cleanMailBoxes from './jobs/remove-old-mails'
import log from './lib/logger'
import { createRequestHandlerForQuery } from './lib/query-helpers'
import { getTypeOfContract } from './lib/utils'
import preCorsController from './pre-cors'

// @ts-ignore
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import passport from 'passport'
import { ExtractJwt, Strategy as JwtStrategy, StrategyOptions } from 'passport-jwt'
import path from 'path'
import responseTime from 'response-time'

// this will tell typescript that `document` exists
// Do not remove unless you know what you're doing
import 'babylonjs' // BABYLON
// Our requires
import { stat } from 'fs/promises'
import throng from 'throng'
import config from '../common/config'
import loadRoutes from '../web/load-routes'
// @ts-expect-error - this is un-typed
import cspSettings from './csp-settings.js'
import { ensureAvatarExists } from './ensure-avatar-exists'
import { parseQueryInt } from './lib/query-parsing-helpers'
import { VoxelsUserRequest } from './user'

// Global error handlers to prevent server crashes
process.on('unhandledRejection', (reason, promise) => {
  log.error('[FATAL] Unhandled Promise Rejection:', reason)
  log.error('Promise:', promise)
})

process.on('uncaughtException', (error) => {
  log.error('[FATAL] Uncaught Exception:', error)
})

if (!process.env.CONTRACT_ADDRESS) {
  log.error('Missing .env file or process.env.CONTRACT_ADDRESS, quitting server')
  process.exit()
}

// JWT Strategy config
const opts: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromExtractors([
    (req) => {
      let token = null

      if (req && req.cookies) {
        token = req.cookies['jwt']
      }

      return token
    },
  ]),
}

opts.secretOrKey = process.env.JWT_SECRET || 'secret'

passport.use(
  new JwtStrategy(opts, function (payload, done) {
    done(null, payload)
  }),
)

passport.use(new AnonymousStrategy())

const signInRateLimit = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 10,
  message: 'Too many request, slow down.',
  statusCode: 429,
  handler: (_req, res) => {
    res.status(429).send({
      success: false,
      error: 'Too many request, slow down.',
    })
  },
})

// Jobs

// Configure express
const app: Express = express()

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[DEV] ${req.method} ${req.path}`, req.query)
    next()
  })
}

// Enable if you're behind a reverse proxy (Heroku, Bluemix, AWS ELB, Nginx, etc) see https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 1)
const httpServer = http.createServer(app)

// Set a 25 second timeout
httpServer.setTimeout(1000 * 25)

app.use(cookieParser())
app.use(bodyParser.json({ limit: '50mb' }))

// Add error handler for body-parser JSON errors (recommended approach)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
    log.error('Malformed JSON request:', {
      url: req.url,
      method: req.method,
      ip: (req as any).ip,
      error: err.message,
      type: (err as any).type || 'unknown',
    })
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON format',
    })
  }

  // Handle other body-parser errors
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'Request entity too large',
    })
  }

  console.log('err', err)

  next(err)
})

app.use(defaultCache)

// add x-response-time header
app.use(responseTime())

preCorsController(passport, app)

// in dev mode we need to proxy to the webpack dev servers
if (config.isDevelopment) {
  const protocol = 'http'

  // In dev mode we need to proxy to the webpack dev servers
  app.use('/proxy/web', cache(false), proxy(`${protocol}://localhost:9200`))
  app.use('/proxy/client', cache(false), proxy(`${protocol}://localhost:9100`))
  app.use(cors())

  // uncomment to test csp settings in report only mode
  // app.use(cspSettings(true))
} else {
  // Redirect root domain to www.
  app.use((req, res, next) => {
    const CANONICAL = 'www.voxels.com'
    const host = req.hostname.toLowerCase()

    if (host === 'cryptovoxels.com' || host === 'www.cryptovoxels.com') {
      res.setHeader('Cache-Control', 'max-age=3600')
      res.redirect(302, `https://${CANONICAL}` + req.originalUrl)
      return
    }

    if (host === 'voxels.com' || host === 'retro.voxels.com') {
      res.setHeader('Cache-Control', 'max-age=3600')
      res.redirect(302, `https://${CANONICAL}` + req.originalUrl)
      return
    }

    next()
  })

  // make sure we set the ContentSecurityPolicy settings
  app.use(cspSettings())

  // and the CSP
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origin.match(/null/i) || origin.match(/localhost/) || origin.match(/cryptovoxels/) || origin.match(/crvox/) || origin.match(/voxels/)) {
          callback(null, true)
        } else {
          callback(new Error(`Origin '${origin}' is not allowed by CORS rules`))
        }
      },
    }),
  )
}

app.get(`/${currentVersion}-client.js`, cache('1 day'), (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'dist', `${currentVersion}-client.js`))
})

app.get(`/${currentVersion}-web.js`, cache('1 day'), (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'dist', `${currentVersion}-web.js`))
})

app.get(`/${currentVersion}-web.css`, cache('1 day'), (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'dist', `web.css`))
})

app.get(`/${currentVersion}-client.css`, cache('1 day'), (req, res) => {
  return res.sendFile(path.join(__dirname, '..', 'dist', `client.css`))
})

app.use(
  expressStaticGzip(path.join(__dirname, '..', 'dist'), {
    enableBrotli: true,
    index: false,
    orderPreference: ['br'],
    serveStatic: {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-if-error=600, stale-while-revalidate=86400')
      },
    },
  }),
)

const gridServer = httpServer
const gridSocket = createGridSocket(gridServer, opts.secretOrKey, PARCEL_EVENT_EMITTER)

export async function dropConnectionsForWallet(wallet: string) {
  gridSocket.removeClientsByWallet(wallet)
  //await publishUserSuspend(wallet)
}

app.all(/.*/, (req, res, next) => {
  if (req.header('host')?.match(/^(untrusted)\..*/i)) {
    noCache(res)
    res.status(404)
  } else {
    next()
  }
})

const timeoutMiddleware = (delay: number) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.socket?.setTimeout(delay)
  next()
}
app.post('/api/signin', signInRateLimit, timeoutMiddleware(5 * 60 * 60 * 1000), SignIn)
app.post('/api/signin/code', signInRateLimit, timeoutMiddleware(5 * 60 * 60 * 1000), EmailCode)
app.post('/api/passkey/available', signInRateLimit, PasskeyAvailable)
app.post('/api/passkey/register/options', signInRateLimit, PasskeyRegisterOptions)
app.post('/api/passkey/register/verify', signInRateLimit, PasskeyRegisterVerify)
app.post('/api/passkey/login/options', signInRateLimit, PasskeyLoginOptions)
app.post('/api/passkey/login/verify', signInRateLimit, PasskeyLoginVerify)

// Search tool
app.get('/api/search', searchAndReturn)

// Used to check the session is valid
app.get('/api/ping', passport.authenticate(['jwt', 'anonymous'], { session: false }), (req, res) => {
  res.json({ success: !!req.user })
})

// Update a parcel if I am the owner
app.put('/grid/parcels/:id', passport.authenticate(['jwt', 'anonymous'], { session: false }), updateParcel)

app.post('/grid/parcels/:id/build', passport.authenticate('jwt', { session: false }), BuildRequestHandler)
// spaces are not on the grid but I couldn't think of a better URI than /grid/...
app.post('/grid/spaces/:id/build', passport.authenticate('jwt', { session: false }), SpaceBuildRequestHandler)

AdminController(db, passport, app)

// Livekit controller
LivekitController(db, passport, app)

// The NFTs
NftController(db, passport, app)

// Scratchpad for all users
ScratchpadController(app)

// Metrics controller
MetricsController(db, app)

// Main client controller
PlayController(db, passport, app)
// parcels controller
ParcelsController(db, passport, app)
// Avatars controller
AvatarsController(db, passport, app)

// Costumes controller
CostumesController(db, passport, app)
// Womps
WompsController(db, passport, app)
// Spaces
SpacesController(db, passport, app)
// collections
CollectionsController(db, passport, app)
// collectibles
CollectiblesController(db, passport, app)
//Events
EventsController(db, passport, app)
// Emoji Badges
EmojiBadgeController(db, passport, app)
// Mails controller
MailsController(db, passport, app)
// Favorites controller
FavoritesController(db, passport, app)
// Asset library controller:
AssetLibraryController(db, passport, app)
// Reports Controller
ModerationReportsController(db, passport, app)
// Externals API Controller
ExternalsController(db, passport, app)

app.get('/api/wearables/:wearable_id/vox', cache('immutable'), async (req, res) => {
  try {
    const wearable = await db.query('sql/get-wearable-by-id', `select * from wearables where id=$1`, [req.params.wearable_id])
    if (!wearable) {
      res.status(404).json({ success: false, message: 'Wearable not found' })
      return
    }

    res.send(wearable.rows[0].data)
  } catch (e) {
    console.error(e)
    res.status(404).json({ success: false, message: 'Wearable not found' })
    return
  }
})

app.get('/api/wearables/:address/:token/vox', cache('immutable'), async (req, res) => {
  try {
    const row = await db.query(
      'sql/get-wearable-by-token',
      `
      select
        *
      from
        wearables
      where
        collection_id = (select id from collections where address ilike $1) and token_id=$2
    `,
      [req.params.address, req.params.token],
    )
    const wearable = row.rows[0]
    return res.send(wearable.data)
  } catch (e) {
    console.error(e)
    res.status(404).json({ success: false, message: 'Wearable not found' })
    return
  }
})

app.get('/w/:hash/:format', cache('immutable'), streamWearable)
// Alternative route
app.get('/c/v2/:chain_identifier/:collection_address/:token_id/:format', cache('immutable'), streamWearable)

app.get('/api/helper/typeOfContract/:chain_identifier/:contract', cache('30 seconds'), async (req, res) => {
  if (!['matic', 'eth'].includes(req.params.chain_identifier)) {
    res.status(400).json({ success: false, message: 'Unsupported' })
    return
  }
  if (!req.params.contract || !ethers.isAddress(req.params.contract)) {
    res.status(404).json({ success: false })
    return
  }
  const chain = req.params.chain_identifier == 'eth' ? 1 : 137
  const typeOfContract = await getTypeOfContract(req.params.contract, chain)
  res.send({ success: true, type: typeOfContract })
})

// Query blockchain and update parcel
app.get('/api/parcels/:id/query', cache('5 seconds'), queryParcel)

// Query subgraph for list of parcels by wallet
app.get('/api/parcels/by/:wallet/query', cache('5 seconds'), refreshParcelsByWallet)

// app.get('/grid/parcels', cache('1 minute'), async (req, res) => {
//   res.json({ success: true, parcels: grid.parcels.map((p) => p.summary) })
// })

app.get('/grid/parcels/:id', cache('10 seconds'), async (req, res) => {
  const id = parseInt(req.params.id, 10)

  if (isNaN(id)) {
    res.status(404)
    return
  }

  const parcel = await Parcel.load(id)

  if (!parcel) {
    noCache(res)
    res.status(404).json({ success: false, message: `No parcel found with id ${id}` })
    return
  }

  res.json({ success: true, parcel: parcel.summary })
})

app.get('/grid/parcels/:id/at/:hash', async (req, res) => {
  const MAX_AGE = 60 * 60 * 24 * 365

  const id = parseInt(req.params.id, 10)

  if (isNaN(id)) {
    res.status(404)
    return
  }

  const parcel = await Parcel.load(id)

  if (!parcel) {
    noCache(res)
    res.status(404).json({ success: false, message: `No parcel found with id ${id}` })
    return
  }

  if (parcel.hash !== req.params.hash) {
    noCache(res)
    res.status(404).json({ success: false, message: `Incorrect hash expected ${parcel.hash}` })
  } else {
    const summary = parcel.summary

    res.setHeader('Cache-Control', `public,max-age=${MAX_AGE},immutable`)
    res.json({ success: true, parcel: summary })
  }
})

// Islands baby!
app.get('/api/islands.json', cache('30 minutes', true), createRequestHandlerForQuery(db, 'get-islands', 'islands'))
app.get('/api/islands-metadata.json', cache('1 hour', true), createRequestHandlerForQuery(db, 'get-islands-metadata', 'islands'))
app.get(
  '/api/islands/:slug.json',
  createRequestHandlerForQuery(db, 'get-island', 'island', (req) => [req.params.slug]),
)

app.get('/api/parcels/cached.json', cache('60 seconds', true), createRequestHandlerForQuery(db, 'get-parcels-cached', 'parcels'))

app.get(
  '/api/parcels/edits/latest.json',
  cache('1 minute'),
  createRequestHandlerForQuery(db, 'get-parcels-by-latest-edit', 'parcels', (req) => {
    const limit = parseQueryInt(req.query.limit, 50)

    return [limit]
  }),
)

app.get(
  '/api/parcels/:id.json',
  cache('15 seconds'),
  passport.authenticate(['jwt', 'anonymous'], { session: false }),
  createRequestHandlerForQuery(db, 'get-parcel', 'parcel', (req) => [parseInt(req.params.id, 10), isOwner(req)]),
)

app.get(
  '/api/wallet/:address/parcels.json',
  cache('5 seconds'),
  createRequestHandlerForQuery(db, 'get-parcels-by-owner', 'parcels', (req) => [req.params.address]),
)

//Get parcels user is a contributors of
app.get(
  '/api/wallet/:address/contributing-parcels.json',
  cache('5 seconds'),
  createRequestHandlerForQuery(db, 'get-parcels-contributing-by-wallet', 'parcels', (req) => [req.params.address]),
)

app.get('/sitemap.txt', cache('1 day', true), sitemap)

app.get('/robots.txt', cache('1 day', true), (req, res) => {
  res.status(200).sendFile('/robots.txt')
})

// Cache is 1 minute because we don't query the DB and we don't query the contract anymore, we query the subgraph.
app.get('/api/names/exists/:name', cache('30 seconds'), async (req, res) => {
  if (!req.params.name) {
    res.status(400).json({ success: false })
    return
  }

  const result = await db.query('sql/names/exists', `select exists(select 1 from names where name=$1)`, [req.params.name])
  const exists = result.rows[0].exists
  res.json({ success: true, exists })
})

// Cache is 1 minute because we don't query the DB and we don't query the contract anymore, we query the subgraph.
app.get('/api/avatar/:wallet/names', cache('1 minutes'), async (req, res) => {
  try {
    const { name, names } = await Avatar.fetchNames(req.params.wallet)
    res.json({ name, names })
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.toString() })
  }
})

app.post('/api/avatar/:wallet/online', passport.authenticate('jwt', { session: false }), (req: VoxelsUserRequest, res: Response) => {
  if (typeof req.params.wallet !== 'string') {
    return res.status(400).send({ success: false, message: 'no wallet in request' })
  }
  if (req.params.wallet.toLowerCase() !== req.user?.wallet?.toLowerCase()) {
    return res.status(401).send({ success: false, message: 'not authorised' })
  }
  ensureAvatarExists(req.params.wallet)
    .then(() => res.status(204).end())
    .catch((err) => {
      res.status(500).send({ success: false, message: 'failed to update online status' })
      log.error(err)
    })
})

loadRoutes(app)

const port = process.env.PORT || 9000 // it's over 9000!

const start = () => {
  httpServer.listen({ port, host: '0.0.0.0' }, function listening() {
    log.info(`HTTP server is listening on http://localhost:${port} (0.0.0.0:${port})`)
  })

  httpServer.on('close', () => {
    log.info(`HTTP server is shutting down`)
  })
}

const master = () => {
  log.info(`master() running on DYNO=${process.env.DYNO} PORT=${port}`) //TODO: Remove

  // clean mail older than x months old at start up or every 3 days
  setTimeout(() => {
    setInterval(() => cleanMailBoxes(), 1000 * 60 * 60 * 24 * 3)
    cleanMailBoxes()
  }, 1000)

  //clean collections with no addresses every day at start up and once per day
  setTimeout(() => {
    setInterval(() => cleanCollections(), 1000 * 60 * 60 * 24)
    cleanCollections()
  }, 1000)

  EthereumListener()
}

const WORKERS = Number(process.env.TEST_WEB_CONCURRENCY || '1')
log.info(`WORKERS=${WORKERS}`) //TODO: Remove

if (WORKERS > 1) {
  throng({
    workers: WORKERS,
    worker: start,
    master: master,
    lifetime: Infinity,
    start,
  })
} else {
  start()
  master()
}
