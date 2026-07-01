import 'babylonjs' // BABYLON
import { EventEmitter } from 'events'
import { ParcelUser } from '../common/helpers/parcel-helper'
import { HTTP2WSBaseURL, isValidUrl } from '../common/helpers/utils'
import { ParcelKind, ParcelRecord, ParcelSettings } from '../common/messages/parcel'
import { getBufferFromVoxels, getFieldShape } from '../common/voxels/helpers'
import { isCommonParcel, isSecurityTeamParcel, isTestIsland } from './lib/helpers'
import { getContract, validateTokenType } from './lib/utils'
import { ground, white } from './parcel-builder'
import db from './pg'

import { bbox } from '@turf/turf'
import { SUPPORTED_CHAINS } from '../common/helpers/chain-helpers'
import { FeatureRecord, FeatureType } from '../common/messages/feature'
const DEGREES_TO_METRES = 100

// query builder - optimized to prevent full table scan on avatars
const loadQuery = () => {
  return `
    SELECT
      p.id,
      y2 - y1 as height,
      p.token,
      p.address,
      p.minted,
      p.kind,
      p.name,
      p.visible,
      content,
      p.geometry_json as geometry,
      CAST (distance_to_center as double precision),
      CAST (distance_to_closest_common as double precision),
      CAST (distance_to_ocean as double precision),
      p.island,
      suburbs.name as suburb,
      p.x1,
      p.x2,
      y1,
      y2,
      p.z1,
      p.z2,
      memoized_hash as hash,
      (select array_to_json(array_agg(row_to_json(t))) from (select wallet,role from parcel_users where parcel_id=p.id) t) as parcel_users,
      is_common,
      lightmap_url,
      label,
      p.description,
      p.owner,
      p.settings
    FROM
      properties p
    left join suburbs on suburbs.id = p.suburb_id
    WHERE
      p.id = $1
  `
}

export interface ParcelEventEmitter {
  on(event: 'metaUpdate', listener: (parcelId: number) => void): this
  on(event: 'scriptUpdate', listener: (parcelId: number) => void): this

  emit(event: 'metaUpdate', parcelId: number): boolean
  emit(event: 'scriptUpdate', parcelId: number): boolean
}

class ParcelEventEmitterInternal extends EventEmitter implements ParcelEventEmitter {
  constructor() {
    super()
  }
}

export const PARCEL_EVENT_EMITTER: ParcelEventEmitter = new ParcelEventEmitterInternal()

export type LightmapStatus = 'None' | 'Requested' | 'Baking' | 'Baked' | 'Failed' | 'HashMismatch'

export class ParcelRef {
  id: number
  name: string
  description: string
  hash: string
  island: string
  kind: ParcelKind = 'plot'
  suburb: string
  owner: string
  parcel_users: ParcelUser[] | null
  settings: ParcelSettings
  is_common: boolean // needed for parcel_auth

  lightmap_url: string | null

  constructor(row: any) {
    this.id = row.id
    this.name = row.name
    this.description = row.description
    this.suburb = row.suburb
    this.kind = row.kind
    this.hash = row.hash
    this.island = row.island
    this.owner = row.owner
    this.parcel_users = row.parcel_users
    this.settings = row.settings
    this.lightmap_url = row.lightmap_url
    this.is_common = row.is_common
  }
}

export type ParcelSaveOptions = {
  snapshotName?: string
}

export abstract class AbstractParcel implements ParcelRef {
  id!: number
  spaceId: string | undefined
  height!: number
  address!: string
  geometry: any
  content!: Record<string, any>
  owner!: string
  kind: ParcelKind = 'plot'
  parcel_users!: ParcelUser[] | null
  description!: string
  lightmap_url!: string | null
  name!: string
  suburb!: string
  island!: string
  features: any
  minted!: boolean
  visible!: boolean
  label!: string
  updated_at: any
  minted_at: any
  hash!: string
  x1!: number
  y1!: number
  z1!: number
  x2!: number
  y2!: number
  z2!: number
  vm: any
  is_common = false
  settings!: ParcelSettings

  constructor(row: any) {
    if (row) {
      Object.assign(this, row)
    }
  }

  get fieldShape(): [number, number, number] {
    return getFieldShape(this)
  }

  get voxels(): string {
    return this.content && this.content.voxels ? this.content.voxels : ''
  }

  set voxels(voxelsStringified: string) {
    if (!this.content) {
      this.content = {}
    }
    this.content.voxels = voxelsStringified
  }

  loadField() {
    return getBufferFromVoxels(this)
  }

  getFeatureByUuid(uuid: string): FeatureRecord | undefined {
    return this.content && Array.isArray(this.content.features) && this.content.features.find((f: FeatureRecord | null) => f && f?.uuid === uuid)
  }

  getFeaturesByType<T extends FeatureType>(type: T): (FeatureRecord & { type: T })[] {
    return (this.content && this.content.features && this.content.features.filter((f: FeatureRecord | null) => f && f?.type === type)) || []
  }

  get ownedByCorporation() {
    return this.owner === process.env.CREATOR_ADDRESS || this.owner === process.env.OWNER_ADDRESS
  }

  get min() {
    return new BABYLON.Vector3(Math.round(this.bbox[0] * DEGREES_TO_METRES), 0, Math.round(this.bbox[1] * DEGREES_TO_METRES))
  }

  get max() {
    return new BABYLON.Vector3(Math.round(this.bbox[2] * DEGREES_TO_METRES), this.height, Math.round(this.bbox[3] * DEGREES_TO_METRES))
  }

  get bounds() {
    return new BABYLON.BoundingBox(this.start, this.end)
  }

  get bbox() {
    return bbox(this.geometry)
  }

  get start() {
    return new BABYLON.Vector3(Math.round(this.bbox[0] * 100), 0, Math.round(this.bbox[1] * 100))
  }

  get end() {
    return new BABYLON.Vector3(Math.round(this.bbox[2] * 100), this.height, Math.round(this.bbox[3] * 100))
  }

  // get x1 () { return Math.round(this.bbox[0] * 100) }
  // get y1 () { return 0 }
  // get z1 () { return Math.round(this.bbox[1] * 100) }

  // get x2 () { return Math.round(this.bbox[2] * 100) }
  // get y2 () { return this.height }
  // get z2 () { return Math.round(this.bbox[3] * 100) }

  // get resolution () {
  //   return [this.width, this.height, this.depth]
  // }

  _justGotMinted = false // Should we automatically set visible = true on the next save()?

  get defaultMaterial() {
    let mt = ground
    switch (this.island) {
      case 'Igloo':
        mt = 2 // glass for igloo;
        break
      case 'Scarcity':
        mt = 16 // Scarcity uses a default tileset; #15 is a black rock
        break
      case 'Flora':
        mt = 16 // Flora uses a default tileset; #16 is a greenish tile
        break
      case 'Pastel':
        mt = 3 // Pastel uses a solid (no black lines at edges) tile
        break
      default:
        break
    }
    return mt
  }

  get defaultGroundMaterial() {
    return this.island === 'Pastel' ? white : ground
  }

  get summary() {
    return {
      id: this.id,
      hash: this.hash,
      features: this.allFeatures,
      settings: this.settings,
      voxels: this.voxels,
      owner: this.owner,
      lightmap_url: this.lightmap_url,
      parcel_users: this.parcel_users,
      description: this.description,
      name: this.name,
      label: this.label,
      address: this.address,
      suburb: this.suburb,
      island: this.island,
      x1: this.x1,
      y1: this.y1,
      z1: this.z1,
      x2: this.x2,
      y2: this.y2,
      z2: this.z2,
      tileset: this.content && this.content.tileset,
      brightness: this.content && this.content.brightness,
      palette: this.content && this.content.palette,
      vox: this.content && this.content.vox,
      is_common: this.is_common,
      visible: this.visible,
      kind: this.kind,
    }
  }

  get privateSummary() {
    return Object.assign({}, this.summary, {
      features: this.allFeatures,
    })
  }

  get allFeatures() {
    // For grid worker performance: if parcel has content, use its features
    // Otherwise fall back to generating outline (expensive operation)
    if (this.content && this.content.features) {
      return this.content.features
    }

    // Only generate outline if absolutely necessary
    // This is expensive (~500ms) due to voxel generation
    return
  }

  setContent(content: Record<string, any>) {
    // remove legacy content.settings
    delete content.settings

    if (this.content) {
      Object.assign(this.content, content)
    } else {
      this.content = content
    }
  }

  async queryContract(): Promise<AbstractParcel> {
    const contract = await getContract('parcel', SUPPORTED_CHAINS['eth'])
    let exists = false
    try {
      exists = await contract.exists(this.id)
    } catch {}

    if (exists) {
      if (!this.minted) this._justGotMinted = true
      this.minted = true
      if (!isSecurityTeamParcel(this)) this.owner = await contract.ownerOf(this.id)
    } else {
      this.minted = isCommonParcel(this) || isTestIsland(this)
    }
    await this.save()
    return this
  }

  async reload(orphan?: Parcel) {
    if (orphan) {
      // todo - do some optimisations to not requery from the database
    }

    const result = await db.query('embedded/get-parcel', loadQuery(), [this.id])

    Object.assign(this, result.rows[0])
  }

  get onlyTokenHoldersCanEnter() {
    return !!this.settings.tokensToEnter?.length
  }

  cleanNullFeatures() {
    if (!this.content) {
      this.content = {}
    }
    this.content.features = this.content.features?.filter((f: any) => !!f) || []
  }

  public abstract save(): Promise<boolean>

  broadcastMeta() {
    PARCEL_EVENT_EMITTER.emit('metaUpdate', this.id)
  }

  broadcastParcelScriptUpdate() {
    PARCEL_EVENT_EMITTER.emit('scriptUpdate', this.id)
  }

  async revert(parcelVersionId: number) {
    const response = await db.query('embedded/get-parcel-version-content', `select content from property_versions where id = $1`, [parcelVersionId])

    if (!response?.rows[0]?.content) {
      return { success: false }
    }

    const snapshotContent = response.rows[0].content

    this.setContent(snapshotContent)

    await this.save()

    this.broadcastMeta()
  }

  /**
   * This is the code to programmatically set a `label` to a parcel in teh database
   * For example: 'Gallery', 'bar', 'hotel'...
   * This label is then used to make map icons or to sort parcels.
   */
  async updateLabel(label: string): Promise<boolean> {
    const isValidLabel = (label: string | undefined) => {
      if (label) {
        let valid = false

        labelSets
          .map((w) => w.name)
          .forEach((word) => {
            if (word.toLowerCase() === label.toLowerCase()) {
              valid = true
            }
          })

        return valid
      } else {
        return true
      }
    }

    if (!isValidLabel(label)) {
      return false
    }
    this.label = label

    const r = await db.query('embedded/update-parcel-label', `update properties set label=$1 where id=$2 returning id`, [this.label, this.id])
    return !!r?.rows[0]?.id
  }

  async updateParcelUsers(body: any): Promise<{ success: boolean; error?: string }> {
    const parcel_users: ParcelUser[] = body.parcel_users ?? []
    /**
     * What this function does is compare the old list of wallets with the new one;
     * if a wallet is not present in the new list but present in the old list, we deleted it.
     */
    const findMissingWalletInNewParcelUsersList = () => {
      return (this.parcel_users?.filter((previousRole) => !parcel_users.find((u) => u.wallet.toLowerCase() == previousRole.wallet.toLowerCase())) ?? []) as ParcelUser[]
    }
    const usersToBeRemovedFromParcel = findMissingWalletInNewParcelUsersList()

    const c = await db.connect()
    let success = true
    try {
      await c.query('BEGIN')
      // Begin a transaction so that if a query fails, we rollback the changes

      // remove all parcel_users associated to the parcel we want to update
      for (const r of usersToBeRemovedFromParcel) {
        await c.query(`delete from parcel_users where parcel_id=$1 and lower(wallet)=lower($2)`, [this.id, r.wallet])
      }

      // Send an insert query for each new role.
      for (const r of parcel_users) {
        await c.query(
          `insert into
        parcel_users (parcel_id, wallet, role)
      values
        ($1, $2, $3)
      ON CONFLICT ON CONSTRAINT parcel_wallet_constraint
      DO
        UPDATE SET role = $3;`,
          [this.id, r.wallet.toLowerCase(), r.role],
        )
      }

      await c.query('COMMIT')
    } catch (err: any) {
      await c.query('ROLLBACK') // ROLLBACK any changes if error
      success = false
    } finally {
      c.release()
    }
    if (!success) {
      return { success: false }
    }

    this.parcel_users = parcel_users

    this.broadcastMeta()

    return { success: true }
  }

  get location() {
    const z = Math.round(this.center[1] * 100)
    const x = Math.round(this.center[0] * 100)

    const e = x < 0 ? `${Math.abs(x)}W` : `${x}E`
    const n = z < 0 ? `${Math.abs(z)}S` : `${z}N`
    const u = this.y1 > 0 ? `${this.y1}U` : ''

    return [e, n, u].join(',')
  }

  get center() {
    return [(this.x2 + this.x1) / 200, (this.z2 + this.z1) / 200]
  }

  updateSettings(body: Partial<ParcelRecord['settings']> & Record<string, any>): { shouldUpdateMeta: boolean; shouldUpdateParcelScript: boolean } {
    let shouldUpdateMeta = false
    let shouldUpdateParcelScript = false
    const settings = body.settings || {}
    if ('sandbox' in body) {
      this.settings.sandbox = !!body.sandbox
      shouldUpdateMeta = true
      shouldUpdateParcelScript = true
    }

    if ('hosted_scripts' in body) {
      this.settings.hosted_scripts = !!body.hosted_scripts
      shouldUpdateParcelScript = true
    }

    if ('script_host_url' in body) {
      const script_host_url = body.script_host_url
      if (script_host_url && isValidUrl(script_host_url)) {
        const url = HTTP2WSBaseURL(script_host_url)
        this.settings.script_host_url = url
        shouldUpdateParcelScript = true
      }
    }

    if ('tokensToEnter' in settings) {
      this.settings.tokensToEnter = settings.tokensToEnter.filter(validateTokenType).slice(0, 1)
      shouldUpdateMeta = true
    }

    return { shouldUpdateMeta, shouldUpdateParcelScript }
  }
}

export type ParcelAuthRef = ParcelRef | AbstractParcel

// Automatically sets visible = true if the parcel _justGotMinted.
export default class Parcel extends AbstractParcel {
  distance_to_center!: number
  distance_to_closest_common!: number
  distance_to_ocean!: number

  constructor(row: any) {
    super(row)
    this.spaceId = undefined
  }

  public override async save(options?: ParcelSaveOptions): Promise<boolean> {
    this.cleanNullFeatures()

    await this.createNewParcelVersion(false, options?.snapshotName)

    const client = await db.connect()

    try {
      await client.query('BEGIN')

      await client.query(
        `
      UPDATE
        properties p
      SET
        content = $1,
        owner = $2,
        minted = $3,
        visible = $4,
        name = $5,
        settings = $6,
        lightmap_url = $7,
        description = $8,
        updated_at = NOW()
      WHERE
        id = $9
      `,
        [JSON.stringify(this.content), this.owner, this.minted, this.visible || this._justGotMinted, this.name, JSON.stringify(this.settings), this.lightmap_url, this.description, this.id],
      )

      await client.query('COMMIT')

      // We only automatically set visible = true on the *transition from* unminted to minted
      this._justGotMinted = false
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return true
  }

  // public override async requestBake() {
  //   // queue up new job
  //   await db.query(
  //     'embedded/insert-parcel-bake-job',
  //     `
  //     insert into
  //       ${JOBS_TABLE_NAME} (parcel_id, type, created_at)
  //     values
  //       ($1, 'bake', now())
  //   `,
  //     [this.id],
  //   )
  // }

  // public override async cancelBake() {
  //   // remove previously queued jobs
  //   await db.query(
  //     'embedded/delete-parcel-bake-job',
  //     `
  //     delete from
  //       ${JOBS_TABLE_NAME}
  //     where
  //       type = 'bake' and parcel_id = $1
  //   `,
  //     [this.id],
  //   )
  // }

  public async refreshListedAt(): Promise<boolean> {
    if (!this.id) {
      return false
    }
    try {
      await db.query('embedded/update-parcel-listed', `Update properties set listed_at = NOW() where id = $1`, [this.id])
    } catch {
      return false
    }

    return true
  }

  /**
   * Save the current version of the parcel and set it as snapShot.
   *
   */
  async takeSnapshot() {
    return this.createNewParcelVersion(true)
  }

  // will only create a new parcel version if isSnapshot or if the parcel hasn't been changed for 30 seconds
  // If a version record is created, its snapshot_name will be set to snapshotName, or to the parcel name if that is undefined.
  private async createNewParcelVersion(isSnapshot: boolean, snapshotName?: string) {
    const result = await db.query(
      'embedded/insert-parcel-version',
      `
        INSERT INTO property_versions (parcel_id, content, name, created_at, updated_at, is_snapshot, snapshot_name, content_hash)
        SELECT $1::integer,
               content,
               name,
               now(),
               now(),
               $2::bool,
               coalesce($3, name),
               digest(coalesce(content::text, 'content'), 'sha1')
        FROM properties
        WHERE id = $1
        AND ( properties.updated_at < NOW() - interval '30 seconds' OR $2::bool )
        RETURNING id
      `,
      [this.id, isSnapshot, snapshotName],
    )
    return { success: !!result?.rows[0]?.id, id: result?.rows[0]?.id }
  }

  static async loadRef(id: number): Promise<ParcelRef | null> {
    const result = await db.query(
      'embedded/get-parcel-full-ref',
      `select properties.id, properties.kind, properties.name, description, island, memoized_hash as hash, owner,
      (select array_to_json(array_agg(row_to_json(t))) from (select wallet,role from parcel_users where parcel_id=properties.id) t) as parcel_users,
       is_common, suburbs.name as suburb, settings, lightmap_url from properties
       left join suburbs on suburbs.id = properties.suburb_id
       where properties.id=$1`,
      [id],
    )
    if (!result.rows[0]) {
      return null
    }
    return new ParcelRef(result.rows[0])
  }

  static async load(id: number): Promise<Parcel | null> {
    const result = await db.query('embedded/get-parcel', loadQuery(), [id])

    if (!result?.rows[0]) {
      return null
    }

    return new Parcel(result.rows[0])
  }

  static async loadXYZ(id: number): Promise<Pick<Parcel, 'address' | 'x1' | 'x2' | 'id' | 'y1' | 'y2' | 'z1' | 'z2'> | null> {
    const result = await db.query(
      'embedded/get-parcel-xyz',
      `
    select
      id,
      address,
      p.x1,
      p.x2,
      y1,
      y2,
      p.z1,
      p.z2
      from
      properties p
      where
      id = $1
    `,
      [id],
    )
    if (!result?.rows[0]) {
      return null
    }
    return new Parcel(result.rows[0])
  }

  // this value is debouced and cached in grid-socket
  static async getState(id: number): Promise<Record<string, unknown> | null> {
    const result = await db.query(
      'embedded/get-parcel-state',
      `
      SELECT state FROM properties WHERE id = $1
    `,
      [id],
    )

    const row = result.rows[0]
    return (row && row.state) || null
  }

  // this is called debounced from grid-socket
  static async setState(id: number, state: Record<string, any>) {
    return await db.query(
      'embedded/update-parcel-state',
      `
      UPDATE properties
      SET
        state = $1
      WHERE
        id = $2
    `,
      [state, id],
    )
  }
}

const SANDBOX = 'sandbox'
/* icon name , list of words to search, list of words to exclude (optional)*/
const labelSets: {
  name: string
  include: string[]
  exclude?: string[]
}[] = [
  { name: 'gallery', include: ['gallery', 'art', 'museum', 'exhibition'] },
  { name: 'club', include: ['club', 'dance', 'disco', 'boogie'] },
  { name: 'bar', include: ['bar', 'beer', 'drink'] },
  { name: 'teleports', include: ['teleport', 'portal'] },
  { name: 'library', include: ['library', 'book'] },
  { name: 'park', include: ['park', 'garden', 'forest'] },
  { name: 'animal', include: ['animal', 'zoo', 'pet', 'cat'] },
  { name: 'shops', include: ['shop', 'store', 'market'] },
  { name: 'scenic', include: ['scenic', 'views', 'landmark', 'tourist'] },
  { name: 'beach', include: ['beach', 'sand', 'waves'], exclude: [SANDBOX, 'wizards'] },
  { name: 'factory', include: ['factory', 'usine', 'manufacturing'] },
  { name: 'sports', include: ['activities', 'soccer', 'rugby', 'sport', 'tennis', 'badminton', 'swimming', 'olympic', 'sports'] },
  { name: 'rest', include: ['bed', 'rest', 'hotel', 'appartment', 'home'] },
  { name: 'education', include: ['education', 'university', 'school', 'college'] },
  { name: 'game', include: ['games', 'arcade'] },
  { name: 'music', include: ['music', 'live'] },
  { name: 'money', include: ['bank', 'finance', 'auction'] },
  { name: 'concert', include: ['concert', 'sing', 'record'] },
  { name: 'food', include: ['restaurant', 'coffee', 'pizza', 'food', 'burger', 'sushi', 'breakfast'] },
  { name: 'theater', include: ['theater', 'theatre'] },
]
