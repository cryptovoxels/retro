import { unzlibSync } from 'fflate'
import ndarray from 'ndarray'
import { MapParcelRecord } from '../messages/api-parcels'
import { FullParcelRecord, ParcelContentRecord, ParcelGeometry, ParcelKind, SingleParcelRecord } from '../messages/parcel'
import { shorterWallet, ssrFriendlyWindow } from './utils'

const KEYS = [
  'id',
  'address',
  'suburb',
  'island',
  'height',
  'geometry',
  'owner',
  'owner_name',
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

export type UserRightRole = 'owner' | 'contributor' | 'excluded' | 'renter'
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
  owner: string = undefined!
  owner_name: string = undefined!
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
    return this.owner_name || shorterWallet(this.owner || '0x0000000000000000000000000000000000000000')
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
    // We add renters as owners so renter have the same permissions. however they can't edit Contributors
    return this.parcelUsers?.filter((user) => user.role == 'owner' || user.role == 'renter') || []
  }

  isTrueOwner(wallet = '') {
    return wallet?.toLowerCase() === this.owner?.toLowerCase()
  }

  isOwner(wallet: string | null | undefined): boolean {
    if (!wallet) return false
    if (wallet.toLowerCase() === this.owner?.toLowerCase()) return true
    return !!this.owners.find((owner) => wallet.toLowerCase() === owner.wallet.toLowerCase())
  }

  get contributors() {
    return this.parcelUsers?.filter((user) => user.role == 'contributor') || []
  }

  isRenter = (wallet: string | null | undefined): boolean => {
    const renter = (this.parcelUsers?.filter((user) => user.role == 'renter') || [])[0]
    return renter?.wallet.toLowerCase() === wallet?.toLowerCase()
  }

  isContributor = (wallet: string | null | undefined) => {
    return !!this.contributors.find((contributor) => contributor.wallet.toLowerCase() === wallet?.toLowerCase())
  }

  get isSandbox() {
    return this.settings?.sandbox === true
  }
}

export function getParcelHelper(parcel: MapParcelRecord | SingleParcelRecord) {
  return new ParcelHelper(parcel)
}
