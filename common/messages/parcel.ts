////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types for parcel descriptions used in various APIs

import * as t from 'io-ts'
import { FeatureRecord, NullableStr } from './feature'

// Pick fields from a type
export function pickType<P extends t.Props, K extends keyof P>(Model: t.TypeC<P>, name: string | undefined, keys: K[]): t.TypeC<Pick<P, K>> {
  const pickedProps = {} as Pick<P, K>
  keys.forEach((key) => {
    pickedProps[key] = Model.props[key]
  })
  return t.type(pickedProps, name)
}
// Types are defined using io-ts instead of typescript
// See https://github.com/gcanti/io-ts/blob/master/index.md for documentation

export const ParcelAuthResult = t.union([t.literal('Owner'), t.literal('Collaborator'), t.literal('Sandbox'), t.literal('Moderator'), t.literal('Suburb'), t.literal(false)])
export type ParcelAuthResult = t.TypeOf<typeof ParcelAuthResult>

export const LightmapStatus = t.union([t.literal('None'), t.literal('Requested'), t.literal('Baking'), t.literal('Baked'), t.literal('Failed'), t.literal('HashMismatch')])
export type LightmapStatus = t.TypeOf<typeof LightmapStatus>

const ERC20TokensToEnter = t.type(
  {
    address: t.string,
    chain: t.number,
    type: t.literal('erc20'),
    tokenId: t.undefined,
  },
  'ERC20TokensToEnter',
)
export type ERC20TokensToEnter = t.TypeOf<typeof ERC20TokensToEnter>
const ERC721TokensToEnter = t.type(
  {
    address: t.string,
    chain: t.number,
    type: t.literal('erc721'),
    tokenId: t.union([t.string, t.undefined]),
  },
  'ERC721TokensToEnter',
)
export type ERC721TokensToEnter = t.TypeOf<typeof ERC721TokensToEnter>

export const ERC1155TokensToEnter = t.type(
  {
    address: t.string,
    chain: t.number,
    type: t.literal('erc1155'),
    tokenId: t.string,
  },
  'ERC1155TokensToEnter',
)
export type ERC1155TokensToEnter = t.TypeOf<typeof ERC1155TokensToEnter>

export const tokensToEnter = t.union([ERC1155TokensToEnter, ERC721TokensToEnter, ERC20TokensToEnter], 'tokensToEnter')
export type tokensToEnter = t.TypeOf<typeof tokensToEnter>

export const ParcelSettings = t.type({
  tokensToEnter: t.union([t.array(tokensToEnter), t.undefined]),
  sandbox: t.union([t.boolean, t.undefined]),
  hosted_scripts: t.union([t.boolean, t.undefined]),
  script_host_url: t.union([t.string, t.undefined]),
})
export type ParcelSettings = t.TypeOf<typeof ParcelSettings>

export const ParcelGeometry = t.type(
  {
    type: t.literal('Polygon'),
    crs: t.type({
      type: t.literal('name'),
      properties: t.type({
        name: t.string,
      }),
    }),
    coordinates: t.array(t.array(t.tuple([t.number, t.number]))),
  },
  'ParcelGeometry',
)
export type ParcelGeometry = t.TypeOf<typeof ParcelGeometry>

export const ParcelKind = t.union([t.literal('plot'), t.literal('inner'), t.literal('outer'), t.literal('unit'), t.literal('basement'), t.literal('asset'), t.literal('scratchpad')])
export type ParcelKind = t.TypeOf<typeof ParcelKind>

export const FullParcelRecord = t.type(
  {
    id: t.number,
    owner: t.string,
    owner_name: NullableStr,
    name: NullableStr,
    label: NullableStr,
    kind: ParcelKind,
    description: NullableStr,
    hash: NullableStr,
    island: t.string, // this isn't included in /grid/parcels/(id) but *is* included in /api/parcles/cached.json :-/
    suburb: t.string,
    parcel_users: t.union([
      t.array(
        t.type({
          wallet: t.string,
          role: t.union([t.literal('owner'), t.literal('contributor'), t.literal('renter'), t.literal('excluded')]),
        }),
      ),
      t.null,
      t.undefined,
    ]),
    visible: t.boolean,

    x1: t.number,
    x2: t.number,
    y1: t.number,
    y2: t.number,
    z1: t.number,
    z2: t.number,

    address: NullableStr, // 10 parcels lack an address
    geometry: ParcelGeometry,
    height: t.number,
    distance_to_center: t.number,
    distance_to_ocean: t.number,
    distance_to_closest_common: t.number,
    space: t.number,
    lightmap_url: NullableStr,
    is_common: t.boolean,

    // These come from the "content" database field but have a default so are always defined
    voxels: t.string,

    // These come from the "content" database field and so may be undefined
    scripting: t.union([t.boolean, t.string, t.null, t.undefined]),
    tileset: t.union([t.string, t.null, t.literal(false), t.undefined]),
    palette: t.union([t.array(t.string), t.null, t.undefined]),
    features: t.union([t.array(FeatureRecord), t.null]),
    // Unsure of where these are used, but they're returned by the server
    settings: ParcelSettings,
    brightness: t.union([t.number, t.null, t.undefined]),
    vox: t.union([t.unknown, t.undefined]),
  },
  'FullParcelRecord',
)
export type FullParcelRecord = t.TypeOf<typeof FullParcelRecord>

export const MarketplaceParcelRecord = t.intersection([
  t.type({
    // visits is currently not used, but we may want to re-add it in the future?
    // visits: t.array(t.number),
    traffic_visits: t.number,
    minted_at: t.string,
    updated_at: t.string,
  }),
  pickType(FullParcelRecord, undefined, [
    'id',
    'owner',
    'name',
    'description',
    'hash',
    'island',
    'suburb',
    'parcel_users',
    'is_common',
    'owner',
    'height',
    'x1',
    'x2',
    'y1',
    'y2',
    'z1',
    'z2',
    'distance_to_center',
    'distance_to_ocean',
    'distance_to_closest_common',
    'owner_name',
    'address',
  ]),
])
export type MarketplaceParcelRecord = t.TypeOf<typeof MarketplaceParcelRecord>

export const NearbyParcelRecord = pickType(FullParcelRecord, 'NearbyParcelRecord', [
  'id',
  'height',
  'address',
  'name',
  'geometry',
  'distance_to_center',
  'distance_to_ocean',
  'distance_to_closest_common',
  'suburb',
  'owner',
  'owner_name',
])
export type NearbyParcelRecord = t.TypeOf<typeof NearbyParcelRecord>

/**
 * Data provided in  update meta
 */
export const ParcelRef = pickType(FullParcelRecord, 'ParcelRef', ['id', 'owner', 'name', 'description', 'hash', 'island', 'suburb', 'parcel_users', 'is_common', 'settings', 'lightmap_url'])
export type ParcelRef = t.TypeOf<typeof ParcelRef>

/**
 * Data provided in cached parcels
 */
export const SimpleParcelRecord = pickType(FullParcelRecord, 'SimpleParcelRecord', [
  'id',
  'owner',
  'name',
  'hash',
  'kind',
  'island',
  'suburb',
  'parcel_users',
  'lightmap_url',
  'x1',
  'x2',
  'y1',
  'y2',
  'z1',
  'z2',
  'address',
  'geometry',
  'height',
  'distance_to_center',
  'distance_to_ocean',
  'distance_to_closest_common',
])
export type SimpleParcelRecord = t.TypeOf<typeof SimpleParcelRecord>

/**
 * Detailed response of single-parcel fetch /grid/parcel/(id) - doesn't include some fields provided by the SimpleParcelRecord
 */
export const SingleParcelRecord = pickType(FullParcelRecord, 'SingleParcelRecord', [
  'id',
  'hash',
  'kind',
  'features',
  'settings', // undefined
  'scripting', // undefined
  'voxels',
  'owner',
  'lightmap_url',
  'parcel_users',
  'description',
  'name',
  'label',
  'address',
  'suburb',
  'is_common',
  'x1',
  'y1',
  'z1',
  'x2',
  'y2',
  'y2',
  'z1',
  'z2',
  'tileset',
  'brightness',
  'palette',
  'vox',
  'visible',
])
export type SingleParcelRecord = t.TypeOf<typeof SingleParcelRecord>

/**
 * Complete parcel description, derived by combining the simple & single parcels (which gridworker does)
 */
export const ParcelRecord = t.intersection([SimpleParcelRecord, SingleParcelRecord], 'ParcelRecord')
export type ParcelRecord = t.TypeOf<typeof ParcelRecord>

export const ParcelContentRecord = pickType(FullParcelRecord, 'ParcelContentRecord', [
  'features',
  'scripting', // undefined
  'voxels',
  'lightmap_url',
  'tileset',
  'brightness',
  'palette',
])
export type ParcelContentRecord = t.TypeOf<typeof ParcelContentRecord>

/**
 * Minted status is needed by the parcel page to decide whether to display an OpenSea link
 */
export const ParcelWithMintednessRecord = t.intersection([ParcelRecord, t.type({ minted: t.boolean })], 'ParcelWithMintednessRecord')
export type ParcelWithMintednessRecord = t.TypeOf<typeof ParcelWithMintednessRecord>

/**
 * Validates that a simple parcel description has been completed - has had the single-parcel API result added to it
 */
export function isCompleteParcelRecord(p: SimpleParcelRecord): p is ParcelRecord {
  return 'voxels' in p
}

export type ParcelPatch = Partial<{
  brightness: number
  features: Record<string, Partial<FeatureRecord> | null>
  voxels:
    | {
        positions: [x: number, y: number, z: number][]
        value: number
      }
    | string
  lightmap_url: string | null
  palette: string[]
  // Send false to force the operational transformer to update the key
  tileset: string | false
}>
