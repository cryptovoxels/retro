import * as t from 'io-ts'
import { FeatureRecord, NullableStr } from './feature'
import { ParcelSettings } from './parcel'
import { avatarRefCodec } from './avatar-ref'

export const SpaceRecord = t.type(
  {
    id: t.string,
    name: t.string, // compulsory for spaces
    spaceId: t.string,
    x1: t.literal(0),
    y1: t.literal(0),
    z1: t.literal(0),
    width: t.number,
    height: t.number,
    depth: t.number,
    island: t.literal(''),
    suburb: t.literal('The void'),
    address: t.literal('Nowhere near'),
    unlisted: t.boolean,
    slug: NullableStr,
    memoized_hash: t.string,
    state: t.null,
    parcel_id: t.union([t.number, t.null]),
    created_at: t.null, // seems to be all null in db 😔
    updated_at: NullableStr, // seems to mostly be set, but also some nulls?
    visits: t.number,
    content: t.type(
      {
        voxels: t.string, // this is also unwrapped into the voxels field in the play endpoint (via a getter...)
        features: t.array(FeatureRecord),
        environment: t.union([t.literal('day'), t.literal('night'), t.literal('void'), t.null, t.undefined]),
      },
      'Content',
    ),
    owner: avatarRefCodec,
    hash: NullableStr,
    lightmap_url: t.union([t.string, t.null]),
    x2: t.number,
    y2: t.number,
    z2: t.number,
    geometry: t.null,
    area: t.number,
    description: NullableStr,
    settings: ParcelSettings,
    voxels: t.string,
  },
  'SpaceRecord',
)
export type SpaceRecord = t.TypeOf<typeof SpaceRecord>

// used for the /spaces endpoint etc
export const SimpleSpaceRecord = t.intersection([
  t.type({
    id: SpaceRecord.props.id,
    owner: avatarRefCodec,
    name: SpaceRecord.props.name,
    x2: SpaceRecord.props.x2,
    y2: SpaceRecord.props.y2,
    z2: SpaceRecord.props.z2,
    height: SpaceRecord.props.height,
    created_at: SpaceRecord.props.created_at,
  }),
  t.type({
    visits: t.number,
    unlisted: t.boolean,
    feature_count: t.number,
    pagination_count: t.string,
    id: t.string,
  }),
])
export type SimpleSpaceRecord = t.TypeOf<typeof SimpleSpaceRecord>
