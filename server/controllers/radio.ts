import { createClient } from 'redis'
import type { Express } from 'express'
import { tracks } from '../../common/soundtracks'
import { Db } from '../pg'
import { buildSchedule, buildSpots, clip, generateSpot, parseChannel, RadioChannel, sampleWorldTracks, Schedule, utcDay } from '../lib/radio'

const CHANNEL = 'radio:updates'
const DAY = 86400
const WINDOW = 300 // generate spots airing within the next 5 minutes
const PAST = 3600 // ...and backfill ones that aired in the last hour (so the list has history)
// v2: bumping this abandons all old cached spot state (and its stale CDN audio) - fresh slate.
const HASH = (day: number) => `radio:spots:v2:${day}`
const WORLD_KEY = (day: number) => `radio:world:v1:${day}`

type Client = { res: any; channel: RadioChannel }

// Voxels Radio over SSE - same playbook as radar.ts / livekit.ts. The server
// generates near-future DJ spots (only while someone's tuned in), stores their
// state in redis, and republishes the whole playlist so every client gets the
// new spot names instantly.
export default function RadioController(db: Db, app: Express) {
  const sseClients = new Set<Client>()
  let pub: ReturnType<typeof createClient> | null = null
  let busy = false
  let worldBusy = false

  async function spotStates(day: number): Promise<Record<string, { url: string; summary: string; parcelId?: number }>> {
    if (!pub) return {}
    try {
      const all = await pub.hGetAll(HASH(day))
      const out: Record<string, { url: string; summary: string; parcelId?: number }> = {}
      for (const [id, v] of Object.entries(all)) {
        try {
          out[id] = JSON.parse(v)
        } catch {}
      }
      return out
    } catch {
      return {}
    }
  }

  async function worldTracks(day: number) {
    if (!pub) return sampleWorldTracks(db, day)
    try {
      const cached = await pub.get(WORLD_KEY(day))
      if (cached) {
        try {
          return JSON.parse(cached)
        } catch {}
      }
      if (worldBusy) return []
      worldBusy = true
      try {
        const lock = await pub.set(`radio:world:build:${day}`, '1', { NX: true, EX: 120 })
        if (!lock) {
          // another server building - wait briefly for cache
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500))
            const again = await pub.get(WORLD_KEY(day))
            if (again) {
              try {
                return JSON.parse(again)
              } catch {}
            }
          }
          return []
        }
        const list = await sampleWorldTracks(db, day)
        await pub.set(WORLD_KEY(day), JSON.stringify(list), { EX: 2 * DAY })
        return list
      } finally {
        worldBusy = false
      }
    } catch (e: any) {
      console.error('radio world cache', e?.toString?.() ?? e)
      return []
    }
  }

  // deterministic schedule with generated spot urls/summaries overlaid from redis
  async function snapshot(day: number, channel: RadioChannel): Promise<Schedule> {
    const list = channel === 'world' ? await worldTracks(day) : tracks
    const sched = buildSchedule(day, list.length ? list : tracks, channel)
    const states = await spotStates(day)
    for (const spot of sched.spots) {
      const st = states[spot.id]
      if (st) {
        spot.url = st.url
        spot.summary = st.summary
        if (st.parcelId) spot.parcelId = st.parcelId
      }
    }
    return sched
  }

  async function pushSnapshot() {
    const day = utcDay()
    for (const channel of ['soundtrack', 'world'] as RadioChannel[]) {
      // only build world if someone is tuned to it
      if (channel === 'world' && ![...sseClients].some((c) => c.channel === 'world')) continue
      const snap = await snapshot(day, channel)
      const line = JSON.stringify({ type: 'snapshot', channel, schedule: snap })
      if (pub) pub.publish(CHANNEL, line)
      else {
        const data = `data: ${line}\n\n`
        for (const c of sseClients) {
          if (c.channel !== channel) continue
          try {
            c.res.write(data)
          } catch {}
        }
      }
    }
  }

  // generate any spots about to air; cross-server safe via a per-spot lock
  async function generatePass() {
    if (!pub || busy) return
    busy = true
    try {
      const day = utcDay()
      const now = Date.now() / 1000
      for (const spot of buildSpots(day)) {
        const until = day * DAY + spot.atOffset - now
        if (until > WINDOW || until < -PAST) continue // next 5 min + last hour only
        if (await pub.hExists(HASH(day), spot.id)) continue
        const lock = await pub.set(`radio:gen:v2:${spot.id}`, '1', { NX: true, EX: 600 })
        if (!lock) continue // another web server is on it
        try {
          const { url, text, parcelId } = await generateSpot(db, pub, spot.id, spot.kind)
          await pub.hSet(HASH(day), spot.id, JSON.stringify({ url, summary: clip(text, 60), parcelId }))
          await pub.expire(HASH(day), 2 * DAY)
        } catch (e: any) {
          console.error('radio spot failed', spot.id, e?.toString())
        }
      }
    } finally {
      busy = false
    }
  }

  ;(async () => {
    try {
      const client = createClient({ url: process.env.REDIS_URL })
      const sub = client.duplicate()
      // without an error listener a dropped socket throws uncaught and kills the process
      client.on('error', (e) => console.error('radio redis', e?.toString?.() ?? e))
      sub.on('error', (e) => console.error('radio redis sub', e?.toString?.() ?? e))
      await Promise.all([client.connect(), sub.connect()])
      pub = client

      sub.subscribe(CHANNEL, (msg) => {
        try {
          const parsed = JSON.parse(msg)
          const ch = parseChannel(parsed.channel)
          const line = `data: ${msg}\n\n`
          for (const c of sseClients) {
            if (c.channel !== ch) continue
            try {
              c.res.write(line)
            } catch {}
          }
        } catch {}
      })

      // tick while anyone's listening: top up the next spots, then rebroadcast
      setInterval(() => {
        if (sseClients.size === 0) return
        generatePass()
          .then(() => pushSnapshot())
          .catch((e) => console.error('radio tick', e?.toString()))
      }, 15000)
    } catch (e) {
      console.error('Radio: Redis unavailable, radio disabled', e)
    }
  })()

  app.get('/api/radio/live', async (req, res) => {
    const channel = parseChannel(req.query.channel)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const snap = await snapshot(utcDay(), channel)
    res.write(`data: ${JSON.stringify({ type: 'snapshot', channel, schedule: snap })}\n\n`)

    const client: Client = { res, channel }
    sseClients.add(client)
    req.on('close', () => sseClients.delete(client))

    // first listener kicks generation so the next spot is ready in time
    generatePass()
      .then(() => pushSnapshot())
      .catch(() => {})
  })
}
