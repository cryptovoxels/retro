import * as t from 'io-ts'
import { ParcelGeometry } from './parcel'
import { avatarRefCodec } from './avatar-ref'

export const Event = t.type({
  id: t.number,
  parcel_id: t.number,
  author: avatarRefCodec,
  name: t.string,
  description: t.string,
  location: t.union([t.string, t.undefined]),
  color: t.string,
  parcel_name: t.string,
  parcel_owner: avatarRefCodec,
  parcel_address: t.string,
  parcel_description: t.string,
  geometry: t.union([ParcelGeometry, t.undefined]),
  coordinates: t.any,
  parcel_x1: t.number,
  parcel_x2: t.number,
  y1: t.number,
  y2: t.number,
  parcel_z1: t.number,
  parcel_z2: t.number,
  timezone: t.string,
  starts_at: t.string,
  expires_at: t.string,
  created_at: t.union([t.string, t.undefined]),
})

export type Event = t.TypeOf<typeof Event>
