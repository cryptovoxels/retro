import { createClient } from 'redis'
import createWWWServer from './api'
import { createConnection } from './common/pq'
import { APP_NAME } from './constants/appName'
import { createLogger } from './createLogger'
import createServer from './createServer'
import createWebsocketServer from './ws'
import createShards from './ws/shards/shards'
import type { RadarEvent } from './ws/shards/shards'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv')
// Load .env file if it exists, but don't fail if it doesn't
const result = dotenv.config()
if (result.error && result.error.code !== 'ENOENT') {
  // Only throw if there's an error other than file not found
  throw result.error
}
// If file not found, we'll just use environment variables directly

const logger = createLogger(process.env.APP_NAME)

const shutdownSignaller = new AbortController()
process.once('SIGINT', () => {
  logger.info('Received SIGINT, shutting down')
  shutdownSignaller.abort('ABORT:SIGINT received')

  // if we receive SIGINT again, exit immediately
  process.once('SIGINT', () => process.exit(0))
})

function ensureEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Environment variable '${name}' is required`)
  return value
}

const RADAR_CHANNEL = 'radar:updates'
const RADAR_TTL = 60
const RADAR_HEARTBEAT_MS = 30_000

async function start(signal: AbortSignal) {
  logger.debug('starting server')

  const jwtSecret = ensureEnv('JWT_SECRET')

  const connection = createConnection(APP_NAME)
  const server = createServer(logger)

  let redis: ReturnType<typeof createClient> | null = null
  if (process.env.REDIS_URL) {
    try {
      redis = createClient({ url: process.env.REDIS_URL })
      await redis.connect()
      logger.info('Multiplayer: Redis connected')
    } catch (e) {
      logger.error('Multiplayer: Redis unavailable, radar disabled', e)
      redis = null
    }
  }

  const onRadarEvent = redis
    ? (e: RadarEvent) => {
        if (e.type === 'move') {
          const val = JSON.stringify({ avatar: e.avatar, parcel: e.parcel })
          redis!.set(`radar:${e.uuid}`, val, { EX: RADAR_TTL }).catch(() => {})
          redis!.publish(RADAR_CHANNEL, JSON.stringify(e)).catch(() => {})
        } else {
          redis!.del(`radar:${e.uuid}`).catch(() => {})
          redis!.publish(RADAR_CHANNEL, JSON.stringify(e)).catch(() => {})
        }
      }
    : undefined

  const shards = await createShards(
    (topic, message, isBinary) => server.publish(topic, message, isBinary),
    logger,
    connection,
    jwtSecret,
    onRadarEvent,
  )

  // Heartbeat: re-SET all logged-in world clients to refresh TTL
  if (redis) {
    setInterval(() => {
      for (const c of shards.worldShard.getClientList()) {
        if (!c.loggedIn || c.lastSeenParcel === null) continue
        const val = JSON.stringify({ avatar: c.avatar, parcel: c.lastSeenParcel })
        redis!.set(`radar:${c.clientUUID}`, val, { EX: RADAR_TTL }).catch(() => {})
      }
    }, RADAR_HEARTBEAT_MS)
  }

  createWWWServer(server.server, logger, shards)
  createWebsocketServer(server, server.server, logger, shards)

  signal.addEventListener('abort', () => {
    // ensure we exit if the server does not close in time
    setTimeout(() => {
      console.warn('Server did not shutdown gracefully in time, forcing shutdown')
      process.exit(0)
    }, 5000)
    try {
      logger.debug('HTTP server closing...')
      server.server.close(() => {
        logger.debug('HTTP server closed')
        process.exit(0)
      })
    } catch (err) {
      logger.error('Error closing HTTP server', err)
      process.exit(0)
    }
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3780
  server.server.listen(port, () => {
    logger.info('Listening on port ' + port)
  })
}

// let's go! 🚀🚀🚀
start(shutdownSignaller.signal)
