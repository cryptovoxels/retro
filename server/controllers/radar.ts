import { createClient } from 'redis'
import { Express } from 'express'

const CHANNEL = 'radar:updates'
const KEY_PREFIX = 'radar:'
const SYNC_MS = 30_000

export default async function RadarController(app: Express) {
  const sseClients = new Set<any>()
  let pub: ReturnType<typeof createClient> | null = null
  let redisReady: Promise<void> = Promise.resolve()

  // Track known UUIDs so we can emit synthetic leave on prune
  const knownUuids = new Set<string>()

  async function getSnapshot() {
    if (!pub) return []
    const keys: string[] = []
    let cursor = 0
    do {
      const r = await pub.scan(cursor, { MATCH: `${KEY_PREFIX}*`, COUNT: 100 })
      cursor = r.cursor
      keys.push(...r.keys)
    } while (cursor !== 0)
    if (!keys.length) return []
    const vals = await pub.mGet(keys)
    return keys
      .map((k, i) => {
        try {
          return { uuid: k.slice(KEY_PREFIX.length), ...JSON.parse(vals[i] ?? 'null') }
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }

  function send(res: any, data: object) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch {}
  }

  async function syncPresence() {
    const users = await getSnapshot()
    const live = new Set(users.map((u: any) => u.uuid))
    for (const uuid of knownUuids) {
      if (!live.has(uuid)) {
        knownUuids.delete(uuid)
        const line = `data: ${JSON.stringify({ type: 'leave', uuid })}\n\n`
        sseClients.forEach((r) => {
          try {
            r.write(line)
          } catch {}
        })
      }
    }
    for (const uuid of live) knownUuids.add(uuid)
    const line = `data: ${JSON.stringify({ type: 'snapshot', users })}\n\n`
    sseClients.forEach((r) => {
      try {
        r.write(line)
      } catch {}
    })
  }

  redisReady = (async () => {
    try {
      const client = createClient({ url: process.env.REDIS_URL })
      const sub = client.duplicate()
      // without an error listener a dropped socket throws uncaught and kills the process
      client.on('error', (e) => console.error('radar redis', e?.toString?.() ?? e))
      sub.on('error', (e) => console.error('radar redis sub', e?.toString?.() ?? e))
      await Promise.all([client.connect(), sub.connect()])
      pub = client

      sub.subscribe(CHANNEL, (msg) => {
        try {
          const event = JSON.parse(msg)
          if (event.type === 'move') knownUuids.add(event.uuid)
          else if (event.type === 'leave') knownUuids.delete(event.uuid)
          const line = `data: ${msg}\n\n`
          sseClients.forEach((r) => {
            try {
              r.write(line)
            } catch {}
          })
        } catch {}
      })

      // Heartbeat only SETs redis keys; push snapshots so SSE clients stay in sync
      setInterval(() => {
        syncPresence().catch(() => {})
      }, SYNC_MS)
    } catch (e) {
      console.error('Radar: Redis unavailable, live presence disabled', e)
    }
  })()

  app.get('/api/users/live', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    await redisReady
    const users = await getSnapshot()
    for (const u of users) knownUuids.add(u.uuid)
    send(res, { type: 'snapshot', users })

    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })
}
