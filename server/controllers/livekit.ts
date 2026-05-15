import cache from '../cache'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import { AccessToken, WebhookReceiver, RoomServiceClient, Room } from 'livekit-server-sdk'

const success = true

export default async function LivekitController(db: Db, passport: PassportStatic, app: Express) {
  const svc = new RoomServiceClient('https://voxels-7pvk06qt.livekit.cloud', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

  const emptyTimeout = 10 * 60
  const maxParticipants = 69

  // get rooms
  let rooms = await svc.listRooms()

  async function refresh() {
    rooms = await svc.listRooms()
  }

  app.get('/api/rooms', (req, res) => {
    res.json({ success, rooms })
  })

  app.get('/api/rooms/:name', async (req, res) => {
    const name = req.params.name.toString()

    if (!name.match(/^[a-z_]{0,9}$/)) {
      res.status(401).send({ error: 'Invalid room name' })
      return
    }

    const room = rooms.find((r) => r.name == req.param.name)

    if (!room) {
      res.status(404).send({ error: 'Room not found' })
      return
    }

    res.json({ success, room })
  })

  // passport.authenticate('jwt', { session: false }),
  app.get('/api/rooms/:name/token', cache(false), async (req, res) => {
    const wallet = req.user ? (req.user as Express.User & { wallet: string }).wallet : `anon-${Math.random().toString(36).slice(2)}`
    const identity = (req.query.identity as string) || wallet

    // if (!wallet) {
    //   res.status(401).send({ error: 'Not Authorized' })
    //   return
    // }

    const name = req.params.name.toString()

    if (!name.match(/^[a-z_]{0,9}$/)) {
      res.status(401).send({ error: 'Invalid room name' })
      return
    }

    let room = rooms.find((r) => r.name == req.param.name)

    if (!room) {
      const opts = {
        name,
        emptyTimeout,
        maxParticipants,
      }
      room = await svc.createRoom(opts)
      refresh()
    }

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
    })

    at.addGrant({
      roomJoin: true,
      room: name,
      canPublish: true,
      canSubscribe: true,
    })

    const token = at.toJwt()
    res.json({ success, room, token })
  })
}
