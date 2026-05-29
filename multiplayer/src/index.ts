import { createClient } from 'redis'
import createWWWServer from './api'
import { createConnection } from './common/pq'
import { APP_NAME } from './constants/appName'
import createServer from './createServer'
import createWebsocketServer from './ws'
import createShards from './ws/shards/shards'
import type { RadarEvent } from './ws/shards/shards'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv')
const result = dotenv.config()
if (result.error && result.error.code !== 'ENOENT') {
  throw result.error
}

process.on('uncaughtException', (err) => console.error('uncaughtException', err))
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err))

const shutdownSignaller = new AbortController()
process.once('SIGINT', () => {
  console.log('Received SIGINT, shutting down')
  shutdownSignaller.abort('ABORT:SIGINT received')
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
  const jwtSecret = ensureEnv('JWT_SECRET')

  const connection = createConnection(APP_NAME)
  const server = createServer()

  let redis: ReturnType<typeof createClient> | null = null
  if (process.env.REDIS_URL) {
    try {
      redis = createClient({ url: process.env.REDIS_URL })
      redis.on('error', (err) => console.error('Multiplayer: Redis error', err))
      await redis.connect()
      console.log('Multiplayer: Redis connected')
    } catch (e) {
      console.error('Multiplayer: Redis unavailable, radar disabled', e)
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
    connection,
    jwtSecret,
    onRadarEvent,
  )

  // Heartbeat: re-SET all logged-in world clients to refresh TTL
  if (redis) {
    setInterval(() => {
      for (const c of shards.worldShard.getClientList()) {
        if (c.lastSeenParcel === null) continue
        const val = JSON.stringify({ avatar: c.avatar, parcel: c.lastSeenParcel })
        redis!.set(`radar:${c.clientUUID}`, val, { EX: RADAR_TTL }).catch(() => {})
      }
    }, RADAR_HEARTBEAT_MS)
  }

  createWWWServer(server.server, shards)
  createWebsocketServer(server, server.server, shards)

  signal.addEventListener('abort', () => {
    setTimeout(() => {
      console.warn('Server did not shutdown gracefully in time, forcing shutdown')
      process.exit(0)
    }, 5000)
    try {
      server.server.close(() => process.exit(0))
    } catch (err) {
      console.error('Error closing HTTP server', err)
      process.exit(0)
    }
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3780
  server.server.listen(port, () => {
    console.log('Listening on port ' + port)
  })
}

// let's go! 🚀🚀🚀
start(shutdownSignaller.signal)
