import { unzlibSync } from 'fflate'
import ndarray from 'ndarray'
import { MapParcelRecord } from '../messages/api-parcels'
import { FullParcelRecord, ParcelContentRecord, ParcelGeometry, ParcelKind, SingleParcelRecord } from '../messages/parcel'
import { shorterWallet, ssrFriendlyWindow } from './utils'
import { avatarName } from '../messages/avatar-ref'

const extractWallet = (owner: any): string => (owner && typeof owner === 'object' ? (owner.owner ?? '') : (owner ?? ''))

const KEYS = [
  'id',
  'address',
  'suburb',
  'island',
  'height',
  'geometry',
  'owner',
  'x1',
  'y1',
  'z1',
  'x2',
  'y2',
  'z2',
  'distance_to_center',
  'distance_to_ocean',
  'distance_to_closest_common',
  'content',
  'kind',
  'parcel_users',
  'is_common',
  'settings',
] as const

export type UserRightRole = 'owner' | 'contributor' | 'excluded'
export type ParcelUser = { wallet: string; role: UserRightRole }

export default class ParcelHelper {
  id: number = undefined!
  name?: string
  address?: string
  description?: string
  parcel_users?: Array<ParcelUser> | null
  island?: string
  suburb?: string
  _height: number | undefined
  geometry: ParcelGeometry | undefined = undefined
  owner: any = undefined! // string | AvatarRef
  x1: number = undefined!
  y1: number = undefined!
  z1: number = undefined!
  x2: number = undefined!
  y2: number = undefined!
  z2: number = undefined!
  kind: ParcelKind = 'plot'
  distance_to_center: number = undefined!
  distance_to_ocean: number = undefined!
  distance_to_closest_common: number = undefined!
  content: ParcelContentRecord | null = null
  is_common: boolean | undefined
  settings: Readonly<Partial<FullParcelRecord['settings']>> | undefined = undefined

  static has_geometry(obj: any): boolean {
    return (obj.x1 && obj.x2 && obj.y1 && obj.y2 && obj.z1 && obj.y2) || obj.geometry?.coordinates
  }

  // To do: there are a number of different data formats that are passed to the constructor and we should rationalise them
  // | MapParcelRecord | FullParcelRecord | ParcelRecord | SingleParcelRecord...
  constructor(obj: Partial<FullParcelRecord> | Partial<ParcelHelper>) {
    KEYS.forEach((key) => {
      ;(this as Record<string, any>)[key] = (obj as Record<string, any>)[key]
    })
    if ('height' in obj) {
      this._height = obj.height
    }
  }

  get parcelUsers() {
    return this.parcel_users
  }

  get width() {
    return Math.round(this.x2 - this.x1)
  }

  get depth() {
    return Math.round(this.z2 - this.z1)
  }

  get height() {
    return this._height || Math.round(this.y2 - this.y1)
  }
  set height(h: number) {
    this._height = h
  }

  get centroid(): [number, number] {
    let x = 0
    let y = 0
    const coords = this.geometry?.coordinates[0]

    if (!coords) return [0, 0]

    coords.forEach((tuple) => {
      x += tuple[0]
      y += tuple[1]
    })

    return [x / coords.length, y / coords.length]
  }

  get center(): [number, number] {
    return this.x2 ? [(this.x2 + this.x1) / 200, (this.z2 + this.z1) / 200] : this.centroid
  }

  get latLng() {
    return { lat: this.center[1], lng: this.center[0] }
  }

  get locationDegrees() {
    return this.latLng.lat.toFixed(2) + '°, ' + this.latLng.lng.toFixed(2) + '°'
  }

  get visitUrl() {
    return `/parcels/${this.id}/visit`
  }

  get iframeUrl() {
    return `/play?coords=${this.centerLocation}`
  }

  get orbitUrl() {
    return `/play?coords=${this.centerLocation}&mode=orbit`
  }

  public get centerLocation() {
    const z = Math.round(this.center[1] * 100)
    const x = Math.round(this.center[0] * 100)

    const e = x < 0 ? `${Math.abs(x)}W` : `${x}E`
    const n = z < 0 ? `${Math.abs(z)}S` : `${z}N`
    const u = this.y1 > 0 ? `${this.y1}U` : ''

    if (!u) {
      return [e, n].join(',')
    }

    return [e, n, u].join(',')
  }

  public get centerLocationUrl() {
    return `/play?coords=${this.centerLocation}`
  }

  get isWaterFront() {
    return this.distance_to_ocean < 10
  }

  get closestCommon() {
    return this.distance_to_closest_common < 20 ? 'Close' : this.distance_to_closest_common <= 80 ? 'Nearby' : 'Far'
  }

  get voxelCapacity() {
    return this.width * this.height * this.depth * 2 * 2 * 2
  }

  get coords() {
    return {
      x1: this.x1,
      y1: 0,
      z1: this.y1,
      x2: this.x2,
      y2: this.height,
      z2: this.y2,
    }
  }

  get tokenUri() {
    return `https://www.voxels.com/p/${this.id}`
  }

  get etherscanUrl() {
    return `https://etherscan.io/address/${this.owner}`
  }

  get openseaUrl() {
    return `https://opensea.io/assets/ethereum/${process.env.CONTRACT_ADDRESS}/${this.id}`
  }

  get raribleUrl() {
    return `https://rarible.com/token/${process.env.CONTRACT_ADDRESS}:${this.id}?tab=details`
  }

  get ownerName() {
    if (!this.owner) return shorterWallet('0x0000000000000000000000000000000000000000')
    if (typeof this.owner === 'string') return shorterWallet(this.owner)
    return avatarName(this.owner)
  }

  get spawnCoords() {
    return this.centerLocation
  }

  private _spawnUrl: string | null = null
  // The server correctly looks up spawn points for /parcels/:id/visit URLs and issues redirections -- use those.
  async spawnUrl(): Promise<string> {
    if (this._spawnUrl) {
      return this._spawnUrl
    }
    // we're running in node and we can't call fetch without a full URL without a hard crash. Some code that are common
    // between server and web needlessly uses this method, so this defensive about our janky common code
    if (!ssrFriendlyWindow) {
      return this.centerLocationUrl
    }

    // This fetch() follows redirects and wastefully fetches the entire destination page. option { redirect: 'manual' }
    // would be the right thing to do, but it does nothing useful: https://stackoverflow.com/questions/42716082/fetch-api-whats-the-use-of-redirect-manual
    // at least we're using a HEAD request to skip the body
    const result = await fetch(`/parcels/${this.id}/visit`, { method: 'HEAD' })
    if (result.redirected) {
      this._spawnUrl = result.url
      return result.url
    }

    return this.centerLocationUrl
  }

  /** Expensive! Avoid multiple calls */
  get voxelField(): [] | Buffer {
    if (!this.content || !this.content.voxels) {
      return []
    }
    const voxelSize = 0.5
    const shape = [(this.x2 - this.x1) / voxelSize, (this.y2 - this.y1) / voxelSize, (this.z2 - this.z1) / voxelSize]
    const field = ndarray(new Uint16Array(shape[0] * shape[1] * shape[2]), shape)
    const buffer = Buffer.from(this.content.voxels, 'base64')
    const inflated = Buffer.from(unzlibSync(buffer))
    inflated.copy(Buffer.from(field.data.buffer))

    return inflated
  }

  /** Expensive! Avoid multiple calls */
  get numberOfVoxels() {
    const voxels = this.voxelField
    let count = 0
    count = voxels.filter((v: number) => v !== 0).length
    return count
  }

  /** Expensive! Avoid multiple calls */
  get percentageBuilt() {
    const voxNumber = this.numberOfVoxels // avoid calling this twice as it's expensive
    const count = voxNumber > 0 ? voxNumber - this.depth * this.width * 2 * 2 * 2 : 0
    const total = this.voxelCapacity - this.depth * this.width * 2 * 2 * 2 // remove the 2 voxels layer that users can't edit
    return (count / total).toFixed(4)
  }

  get metadataDescription() {
    return this.island == 'Origin City'
      ? `${this.kind == 'inner' ? 'Pre-built ' : ''}parcel near ${this.suburb} in ${this.island}`
      : `${this.kind == 'inner' ? 'Pre-built ' : ''}parcel on ${this.island}, ${Math.floor(this.distance_to_center)}m from the origin, with a ${Math.floor(this.height)}m build height, floor is at ${this.y1}m elevation`
  }

  queryRefresh(callback?: () => void) {
    fetch(`${process.env.API}/parcels/${this.id}/query`)
      .then((r) => r.json())
      .then(() => {
        callback && callback()
      })
  }

  get owners() {
    return this.parcelUsers?.filter((user) => user.role == 'owner') || []
  }

  isTrueOwner(wallet = '') {
    return wallet?.toLowerCase() === this.owner?.toLowerCase()
  }

  isOwner(wallet: string | null | undefined): boolean {
    if (!wallet) return false
    const w = extractWallet(this.owner)
    if (w && wallet.toLowerCase() === w.toLowerCase()) return true
    return !!this.owners.find((owner) => wallet.toLowerCase() === owner.wallet.toLowerCase())
  }

  get contributors() {
    return this.parcelUsers?.filter((user) => user.role == 'contributor') || []
  }

  isContributor = (wallet: string | null | undefined) => {
    return !!this.contributors.find((contributor) => contributor.wallet.toLowerCase() === wallet?.toLowerCase())
  }

  get isSandbox() {
    return this.settings?.sandbox === true
  }
}

const PLAY_HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

function playMod(n: number, m: number) {
  return ((n % m) + m) % m
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2
}

type FeaturePlayCoordsOpts = { standoff?: number; lateral?: number }

// Parcel center + feature position/rotation -> play coords string (same math as inspect-feature teleport).
export function featurePlayCoords(parcel: ParcelHelper, position: [number, number, number], rotation?: [number, number, number] | null, opts?: FeaturePlayCoordsOpts): string {
  const standoff = opts?.standoff ?? 0
  const lateral = opts?.lateral ?? 0
  const yaw = rotation?.[1] ?? 0
  const px = position[0] - Math.sin(yaw) * standoff + Math.cos(yaw) * lateral
  const py = position[1]
  const pz = position[2] - Math.cos(yaw) * standoff - Math.sin(yaw) * lateral

  const z = roundHalf(parcel.center[1] * 100 + pz)
  const x = roundHalf(parcel.center[0] * 100 + px)
  const y = roundHalf(parcel.y1 + (py - 0.25))

  const parts = [x < 0 ? `${Math.abs(x)}W` : `${x}E`, z < 0 ? `${Math.abs(z)}S` : `${z}N`]
  if (y > 0) parts.push(`${y}U`)

  const i = playMod(Math.round(yaw / ((Math.PI * 2) / PLAY_HEADINGS.length)), PLAY_HEADINGS.length)
  const heading = PLAY_HEADINGS[i]

  return parts.length === 0 ? heading : `${heading}@${parts.join(',')}`
}

export function featurePlayCoordsFromRecord(parcel: Partial<FullParcelRecord> | ParcelHelper, feature: { position?: number[] | null; rotation?: number[] | null }, opts?: FeaturePlayCoordsOpts): string {
  const helper = parcel instanceof ParcelHelper ? parcel : new ParcelHelper(parcel)
  const position: [number, number, number] = [feature.position?.[0] ?? 0, feature.position?.[1] ?? 0, feature.position?.[2] ?? 0]
  const rotation: [number, number, number] | null = feature.rotation ? [feature.rotation[0] ?? 0, feature.rotation[1] ?? 0, feature.rotation[2] ?? 0] : null
  return featurePlayCoords(helper, position, rotation, opts)
}

// Showbox links: parcel floor Y. Lateral matches co-host layout (host/solo guest left, co-host guest right).
const SHOWBOX_BROADCAST_STANDOFF = 1.5
const SHOWBOX_AUDIENCE_STANDOFF = 3.5
const SHOWBOX_HOST_LATERAL = -1
const SHOWBOX_GUEST_LATERAL = 1
const SHOWBOX_AUDIENCE_LATERAL = 0.75

function showboxFloorFeature(feature: { position?: number[] | null; rotation?: number[] | null }) {
  const position = feature.position
  return { position: [position?.[0] ?? 0, 0, position?.[2] ?? 0] as [number, number, number], rotation: feature.rotation }
}

function showboxSpawnCoords(parcel: Partial<FullParcelRecord> | ParcelHelper, feature: { position?: number[] | null; rotation?: number[] | null }, opts: FeaturePlayCoordsOpts) {
  return featurePlayCoordsFromRecord(parcel, showboxFloorFeature(feature), opts)
}

export function showboxHostPlayCoordsFromRecord(parcel: Partial<FullParcelRecord> | ParcelHelper, feature: { position?: number[] | null; rotation?: number[] | null }) {
  return showboxSpawnCoords(parcel, feature, { standoff: SHOWBOX_BROADCAST_STANDOFF, lateral: SHOWBOX_HOST_LATERAL })
}

// Host go-live: one parcel, close draw, optional bare UI on mobile (matches guest broadcast links).
export function showboxHostPlayQuery(coords: string, featureUuid: string, mobileUiOff = false): string {
  const qs = new URLSearchParams({ coords, show: featureUuid, host: '1', isolate: 'true', distance: 'close' })
  if (mobileUiOff) qs.set('ui', 'off')
  return qs.toString()
}

export function showboxGuestPlayCoordsFromRecord(parcel: Partial<FullParcelRecord> | ParcelHelper, feature: { position?: number[] | null; rotation?: number[] | null; guestMode?: string | null }) {
  const lateral = feature.guestMode === 'cohost' ? SHOWBOX_GUEST_LATERAL : SHOWBOX_HOST_LATERAL
  return showboxSpawnCoords(parcel, feature, { standoff: SHOWBOX_BROADCAST_STANDOFF, lateral })
}

export function showboxAudiencePlayCoordsFromRecord(parcel: Partial<FullParcelRecord> | ParcelHelper, feature: { position?: number[] | null; rotation?: number[] | null }) {
  return showboxSpawnCoords(parcel, feature, { standoff: SHOWBOX_AUDIENCE_STANDOFF, lateral: SHOWBOX_AUDIENCE_LATERAL })
}

// Fan share links (copy, share sheet, post). Lean boot for watchers: one parcel, close draw.
export function showboxFanSharePlayQuery(coords: string, featureUuid: string): string {
  const qs = new URLSearchParams({ coords, show: featureUuid, isolate: 'true', distance: 'close' })
  return qs.toString()
}

// Audience /live homepage links. Mobile gets lean boot: one parcel, close draw.
export function audiencePlayQuery(coords: string, mobileLean = false): string {
  const qs = new URLSearchParams({ coords })
  if (mobileLean) {
    qs.set('isolate', 'true')
    qs.set('distance', 'close')
  }
  return qs.toString()
}

export function getParcelHelper(parcel: MapParcelRecord | SingleParcelRecord) {
  return new ParcelHelper(parcel)
}
