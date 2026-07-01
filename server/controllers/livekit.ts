import { createClient } from 'redis'
import cache from '../cache'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import { AccessToken, WebhookReceiver, RoomServiceClient } from 'livekit-server-sdk'
import authParcel from '../auth-parcel'
import Parcel from '../parcel'
import { loadGuestPass } from './guest-passes'
import { VoxelsUser } from '../user'
import { orderLiveStrip } from '../../common/helpers/utils'

const success = true
const CHANNEL = 'live:updates'
const HASH = 'live:thumbnails'

export const livekitService = new RoomServiceClient('https://voxels-7pvk06qt.livekit.cloud', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
function roomViewers(rooms: { name: string; numParticipants?: number }[], room: string): number {
  return rooms.find((r) => r.name === room)?.numParticipants ?? 0
}

export default async function LivekitController(db: Db, passport: PassportStatic, app: Express) {
  const svc = livekitService
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

  const emptyTimeout = 10 * 60
  const maxParticipants = 69

  let rooms: Awaited<ReturnType<typeof svc.listRooms>> = []
  try {
    rooms = await svc.listRooms()
  } catch (e) {
    console.error('LiveKit: listRooms failed, live features disabled', e)
  }

  async function refresh() {
    try {
      rooms = await svc.listRooms()
    } catch (e) {
      console.error('LiveKit: listRooms failed', e)
    }
  }

  async function loadOrderedLiveEntries() {
    await refresh()
    if (!pub) return []
    const all = await pub.hGetAll(HASH)
    const entries = Object.values(all)
      .map((v) => {
        try {
          return JSON.parse(v)
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .map((entry: any) => ({
        ...entry,
        viewers: roomViewers(rooms, entry.room),
      }))
    return orderLiveStrip(entries)
  }

  function pushSnapshot() {
    loadOrderedLiveEntries()
      .then((entries) => {
        const line = `data: ${JSON.stringify({ type: 'snapshot', entries })}\n\n`
        sseClients.forEach((r) => {
          try {
            r.write(line)
          } catch {}
        })
      })
      .catch(console.error)
  }

  // SSE clients connected to this process
  const sseClients = new Set<any>()
  // separate stream for voice cluster discovery - never mixed with the who's-live strip above
  const clusterSseClients = new Set<any>()

  function buildClusterLine(list: Awaited<ReturnType<typeof svc.listRooms>>): string {
    const clusters = list
      .filter((r) => /^cluster-\d+$/.test(r.name) && (r.numParticipants ?? 0) > 0)
      .map((r) => {
        let center: number[] | null = null
        try {
          const meta = r.metadata ? JSON.parse(r.metadata) : null
          const parts = String(meta?.center ?? '')
            .split(',')
            .map(Number)
          if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) center = parts
        } catch {}
        return { room: r.name, center, count: r.numParticipants ?? 0 }
      })
      .filter((c) => c.center)
    return `data: ${JSON.stringify({ type: 'snapshot', clusters })}\n\n`
  }

  // poll livekit into a LOCAL list (never clobbers the shared `rooms`) and push to cluster clients only
  setInterval(async () => {
    if (clusterSseClients.size === 0) return
    let list: Awaited<ReturnType<typeof svc.listRooms>> = []
    try {
      list = await svc.listRooms()
    } catch {}
    const line = buildClusterLine(list)
    clusterSseClients.forEach((r) => {
      try {
        r.write(line)
      } catch {}
    })
  }, 4000)

  // Redis is optional - thumbnail/SSE features degrade gracefully if unavailable
  let pub: ReturnType<typeof createClient> | null = null

  ;(async () => {
    try {
      const client = createClient({ url: process.env.REDIS_URL })
      const sub = client.duplicate()
      // without an error listener a dropped socket throws uncaught and kills the process
      client.on('error', (e) => console.error('livekit redis', e?.toString?.() ?? e))
      sub.on('error', (e) => console.error('livekit redis sub', e?.toString?.() ?? e))
      await Promise.all([client.connect(), sub.connect()])
      pub = client

      sub.subscribe(CHANNEL, (msg) => {
        const line = `data: ${msg}\n\n`
        sseClients.forEach((r) => {
          try {
            r.write(line)
          } catch {}
        })
      })

      // Prune stale entries (broadcaster crashed without sending null)
      setInterval(async () => {
        const all = await client.hGetAll(HASH)
        const cutoff = Date.now() - 12000
        for (const [key, val] of Object.entries(all)) {
          try {
            const entry = JSON.parse(val)
            if (entry.ts < cutoff) {
              await client.hDel(HASH, key)
              client.publish(CHANNEL, JSON.stringify({ type: 'remove', parcel: key }))
            }
          } catch {}
        }
        // Re-rank strip every prune tick: fresh viewer counts + new random discovery slots.
        pushSnapshot()
      }, 10000)
    } catch (e) {
      console.error('LiveKit: Redis unavailable, thumbnail/SSE features disabled', e)
    }
  })()

  app.get('/api/rooms', (req, res) => {
    res.json({ success, rooms })
  })

  app.get('/api/rooms/:name', async (req, res) => {
    const name = req.params.name.toString()
    if (!name.match(/^[a-z0-9-]{1,32}$/)) {
      res.status(400).send({ error: 'Invalid room name' })
      return
    }
    await refresh()
    const room = rooms.find((r) => r.name === name)
    if (!room) {
      res.status(404).send({ error: 'Room not found' })
      return
    }
    res.json({ success, room })
  })

  app.get('/api/rooms/:name/token', cache(false), passport.authenticate(['jwt', 'anonymous'], { session: false }), async (req, res) => {
    const name = req.params.name.toString()
    if (!name.match(/^[a-z0-9-]{1,32}$/)) {
      res.status(400).send({ error: 'Invalid room name' })
      return
    }

    const user = (req.user ?? null) as (VoxelsUser & { guest_pass?: string }) | null
    const wallet = user?.wallet ?? `anon-${Math.random().toString(36).slice(2)}`
    const guestPassToken = String(user?.guest_pass ?? req.query.guest_pass ?? '').trim()

    // Subscribe is open (audience). Publish requires a collaborator or a valid guest pass scoped to this room.
    let canPublish = false
    const parcelMatch = name.match(/^parcel-(\d+)$/)
    if (parcelMatch) {
      const parcelId = parseInt(parcelMatch[1], 10)
      if (guestPassToken) {
        const pass = await loadGuestPass(db, guestPassToken)
        if (pass && !pass.revoked_at && pass.parcel_id === parcelId) {
          canPublish = true
        }
      } else if (user?.wallet) {
        const parcel = await Parcel.load(parcelId)
        if (parcel) {
          const auth = await authParcel(parcel, user)
          if (auth === 'Owner' || auth === 'Collaborator' || auth === 'Moderator') {
            canPublish = true
          }
        }
      }
    }

    // voice cluster rooms (cluster-{parcelId}) are separate from showbox parcel rooms: anyone may
    // speak (audio only) and we stamp the origin parcel coords as the room center, once, at creation.
    const isCluster = /^cluster-\d+$/.test(name)
    let clusterMeta: string | undefined
    if (isCluster) {
      canPublish = true
      const center = String(req.query.center ?? '').trim()
      if (/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(center)) clusterMeta = JSON.stringify({ center })
    }

    let room = rooms.find((r) => r.name === name)
    if (!room) {
      room = await svc.createRoom({ name, emptyTimeout, maxParticipants, metadata: clusterMeta })
      refresh()
    }

    // guest- prefix when publishing via pass so revoke kicks anon and signed-in guest co-hosts.
    // the session wallet (guest:tok12.sess) appends the session to the identity prefix - without
    // it, two guests sharing one link are filtered as each other's "self" and can't be heard.
    let identityPrefix = wallet
    if (user?.guest_pass) {
      const sess = String(user.wallet ?? '').split('.')[1]
      identityPrefix = `guest-${user.guest_pass.slice(0, 12)}` + (sess ? `-${sess}` : '')
    } else if (canPublish && guestPassToken) {
      // signed-in (non-editor) guests have no session wallet - their real wallet is the session,
      // so two signed-in users on the same link don't collide either
      const w = wallet
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-6)
        .toLowerCase()
      identityPrefix = `guest-${guestPassToken.slice(0, 12)}` + (w ? `-${w}` : '')
    }
    const reuseIdentity = String(req.query.identity ?? '').trim()
    let identity: string
    if (reuseIdentity && /^[a-zA-Z0-9._-]+$/.test(reuseIdentity) && reuseIdentity.startsWith(`${identityPrefix}-`)) {
      identity = reuseIdentity
    } else {
      identity = `${identityPrefix}-${Math.random().toString(36).slice(2, 10)}`
    }

    // in a cluster the identity is the bare avatar uuid so clients can map an audio track to an avatar
    if (isCluster && /^[a-zA-Z0-9-]{1,40}$/.test(reuseIdentity)) identity = reuseIdentity

    // guest-pass tokens expire fast so revoke actually revokes: livekit has no token blocklist,
    // and the sdk default 6h ttl let a kicked guest rejoin with a cached token. reconnect paths
    // always fetch a fresh token, so a short ttl only narrows the post-revoke window.
    const guestTtl = user?.guest_pass || (canPublish && guestPassToken) ? '15m' : undefined
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, guestTtl ? { identity, ttl: guestTtl } : { identity })
    at.addGrant({ roomJoin: true, room: name, canPublish, canSubscribe: true })
    res.json({ success, room, token: at.toJwt(), canPublish })
  })

  app.post('/api/rooms/:name/thumbnail', async (req, res) => {
    if (!pub) {
      res.json({ success })
      return
    }
    const name = req.params.name.toString()
    const { avatar, parcel, coord, thumbnail } = req.body ?? {}

    if (thumbnail === null || thumbnail === undefined) {
      await pub.hDel(HASH, name)
      pub.publish(CHANNEL, JSON.stringify({ type: 'remove', parcel: name }))
    } else {
      await refresh()
      const viewers = roomViewers(rooms, name)
      const entry = { room: name, parcel, coord, avatar, thumbnail, ts: Date.now(), viewers }
      await pub.hSet(HASH, name, JSON.stringify(entry))
      pub.publish(CHANNEL, JSON.stringify({ type: 'update', room: name, parcel, coord, avatar, thumbnail, viewers, ts: entry.ts }))
    }

    res.json({ success })
  })

  app.get('/api/live', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    if (pub) {
      const entries = await loadOrderedLiveEntries()
      res.write(`data: ${JSON.stringify({ type: 'snapshot', entries })}\n\n`)
    } else {
      res.write(`data: ${JSON.stringify({ type: 'snapshot', entries: [] })}\n\n`)
    }

    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })

  app.get('/api/clusters', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      res.write(buildClusterLine(await svc.listRooms()))
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'snapshot', clusters: [] })}\n\n`)
    }

    clusterSseClients.add(res)
    req.on('close', () => clusterSseClients.delete(res))
  })
}
