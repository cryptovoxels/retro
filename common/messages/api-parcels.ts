////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for /api/parcels and /grid/parcels messages

import * as t from 'io-ts'
import { FullParcelRecord, SimpleParcelRecord, SingleParcelRecord } from './parcel'

/**
 * /api/parcels/cached.json
 */
export const CachedParcelsMessage = t.type(
  {
    success: t.boolean,
    parcels: t.array(SimpleParcelRecord),
  },
  'CacheParcelsMessage',
)
export type CachedParcelsMessage = t.TypeOf<typeof CachedParcelsMessage>

/**
 * /grid/parcels/:id
 */
export const ApiParcelMessage = t.type(
  {
    success: t.boolean,
    parcel: SingleParcelRecord,
  },
  'ApiParcelMessage',
)
export type ApiParcelMessage = t.TypeOf<typeof ApiParcelMessage>

/**
 * /api/parcels/:/revert
 */
export const ApiStatusResponse = t.type(
  {
    success: t.boolean,
    message: t.string,
  },
  'ApiStatusResponse',
)
export type ApiStatusResponse = t.TypeOf<typeof ApiStatusResponse>

/**
 * Parcel included in /api/parcels/map.json
 */
export const MapParcelRecord = t.type(
  {
    id: FullParcelRecord.props.id,
    address: FullParcelRecord.props.address,
    name: FullParcelRecord.props.name,
    parcel_users: FullParcelRecord.props.parcel_users,
    geometry: FullParcelRecord.props.geometry,
    owner: FullParcelRecord.props.owner,
    x1: FullParcelRecord.props.x1,
    x2: FullParcelRecord.props.x2,
    label: FullParcelRecord.props.label,
    y2: FullParcelRecord.props.y2,
    z1: FullParcelRecord.props.z1,
    z2: FullParcelRecord.props.z2,
    is_common: FullParcelRecord.props.is_common,
    suburb: FullParcelRecord.props.suburb,
    settings: FullParcelRecord.props.settings,
  },
  'MapParcelRecord',
)
export type MapParcelRecord = t.TypeOf<typeof MapParcelRecord>

/**
 * /api/parcels/map.json
 */
export const ApiParcelMapMessage = t.type(
  {
    success: t.boolean,
    parcels: t.array(MapParcelRecord),
  },
  'ApiParcelMapMessage',
)
export type ApiParcelMapMessage = t.TypeOf<typeof ApiParcelMapMessage>
