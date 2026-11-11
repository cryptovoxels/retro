import type { Express } from 'express'
import type { PassportStatic } from 'passport'
import { jwtVerify, SignJWT } from 'jose'
import ndarray from 'ndarray'
import { getVoxelsFromBuffer } from '../common/voxels/helpers'
import Avatar from './avatar'
import authParcel from './auth-parcel'
import { noCache } from './cache'
import type GridSocket from './grid/GridSocket'
import Parcel from './parcel'
import type { VoxelsUserRequest } from './user'

export default function skynet(app: Express, passport: PassportStatic, grid: GridSocket) {
  // Separate signing key: this link can never authenticate as a normal account.
  const key = process.env.JWT_SECRET && new TextEncoder().encode('skynet:' + process.env.JWT_SECRET)
  app.post('/api/parcels/:id/skynet', passport.authenticate('jwt', { session: false }), async (req: VoxelsUserRequest, res, next) => {
    try {
      noCache(res)
      if (!key) return res.sendStatus(503)
      const parcel = await Parcel.loadRef(Number(req.params.id))
      if (!parcel || !req.user?.wallet || (await authParcel(parcel, req.user)) !== 'Owner') return res.sendStatus(403)
      const token = await new SignJWT({ parcel: parcel.id }).setSubject(req.user.wallet).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('12h').sign(key)
      res.json({ token })
    } catch (err) {
      next(err)
    }
  })

  app.post('/api/parcels/:id/skynet/voxels', async (req, res, next) => {
    try {
      noCache(res)
      const id = Number(req.params.id)
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      const verified = key && token && (await jwtVerify(token, key, { algorithms: ['HS256'] }).catch(() => null))
      if (!verified || verified.payload.parcel !== id || !verified.payload.sub) return res.sendStatus(403)
      const parcel = await Parcel.load(id)
      if (!parcel || (await Avatar.getSuspended(verified.payload.sub)) || (await authParcel(parcel, { wallet: verified.payload.sub })) !== 'Owner') return res.sendStatus(403)
      const { positions, value } = req.body || {}
      const shape = parcel.fieldShape
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 65535 ||
        !Array.isArray(positions) ||
        !positions.length ||
        positions.length > 128 ||
        !positions.every((p: number[]) => Array.isArray(p) && p.length === 3 && p.every((n, i) => Number.isInteger(n) && n >= 0 && n < shape[i]))
      )
        return res.sendStatus(400)
      const field = parcel.loadField() ?? ndarray(new Uint16Array(shape[0] * shape[1] * shape[2]), shape)
      if (positions.every(([x, y, z]: number[]) => field.get(x, y, z) === value)) return res.json({ saved: true })
      for (const [x, y, z] of positions) field.set(x, y, z, value)
      parcel.voxels = getVoxelsFromBuffer(field.data.buffer)
      if (!(await parcel.save({ revision: parcel.revision }))) return res.status(409).send('Parcel changed. Read again and retry.')
      grid.broadcastVoxels(id, { positions, value })
      res.json({ saved: true })
    } catch (err) {
      next(err)
    }
  })
}
