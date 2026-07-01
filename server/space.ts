import { isValidUUID } from './lib/helpers'
import { AbstractParcel } from './parcel'

import type { Response } from 'express'
import db from './pg'
import { SpaceRecord } from '../common/messages/space'

/**
 * Spaces are traditionally identified by a string, and that's how they're stored in the database. However, it makes a
 * lot of code more simple and more type-safe if we have a second identifier for spaces, `Parcel.spaceId` and a hard-coded
 * identifier for the single parcel in a space, `Parcel.id`. Programming for this also means it will be much easier to
 * support many parcels in a single space in the future.
 */
export const SINGLE_VALID_SPACE_PARCEL_ID = 0

export default class Space extends AbstractParcel {
  slug: string | undefined
  unlisted: boolean | undefined
  updated_at: string | undefined

  private constructor(spaceId: string, record: SpaceRecord) {
    super(record)
    this.spaceId = spaceId
  }

  get voxels() {
    return this.content && this.content.voxels ? this.content.voxels : ''
  }

  set voxels(voxelsStringified: string) {
    if (!this.content) {
      this.content = {}
    }
    this.content.voxels = voxelsStringified
  }

  static async load(id: string): Promise<Space | null> {
    if (!isValidUUID(id)) {
      return null
    }
    const result = await db.query(
      'embedded/get-space',
      `
      SELECT
        *,
        width as x2,
        height as y2,
        depth as z2,
        settings,
        memoized_hash as hash,
        lightmap_url
      FROM spaces
      WHERE id=$1`,
      [id],
    )

    if (!result?.rows[0]) {
      return null
    }

    const space = result.rows[0]
    space.x1 = 0
    space.y1 = 0
    space.z1 = 0
    space.island = ''
    space.suburb = 'The void'
    space.address = 'Nowhere near'

    // Correct the parcel ID (at the moment, spaces are identified in the database with a guid)
    result.rows[0].id = SINGLE_VALID_SPACE_PARCEL_ID

    return new Space(id, result.rows[0])
  }

  static async loadRef(id: string): Promise<Space | null> {
    const result = await db.query(
      'embedded/get-space-ref-no-content',
      `select 
        name,
        id,
        description,
        created_at,
        updated_at,
        owner,
        state,
        slug,
        width as x2,
        height as y2,
        depth as z2,
        settings,
        memoized_hash as hash,
        lightmap_url
       FROM spaces
      WHERE id=$1`,
      [id],
    )
    if (!result.rows[0]) {
      return null
    }
    const space = result.rows[0]

    space.x1 = 0
    space.y1 = 0
    space.z1 = 0
    space.island = ''
    space.suburb = 'The void'
    space.address = 'Nowhere near'
    // Correct the parcel ID (at the moment, spaces are identified in the database with a guid)
    result.rows[0].id = SINGLE_VALID_SPACE_PARCEL_ID
    return new Space(id, result.rows[0])
  }

  // This value is debounced and cached in grid-socket
  static async getState(id: string): Promise<Record<string, unknown> | null> {
    const result = await db.query(
      'embedded/get-space-state',
      `
      SELECT state FROM spaces WHERE id = $1
    `,
      [id],
    )

    const row = result.rows[0]
    return (row && row.state) || null
  }

  // This is called debounced from grid-socket
  static async setState(id: string, state: Record<string, any>) {
    return await db.query(
      'embedded/update-space-state',
      `
      UPDATE spaces
      SET
        state = $1
      WHERE
        id = $2
    `,
      [state, id],
    )
  }

  public override async save(): Promise<boolean> {
    this.cleanNullFeatures()

    const result = await db.query(
      'embedded/update-space',
      `
        UPDATE
          spaces
        SET
          content = $2::json,
          name = $3,
          description = $4,
          slug = $5,
          settings = $6::json,
          unlisted = $7,
          lightmap_url = $8,
          updated_at = NOW()
        WHERE
          id = $1
          returning id
        `,
      [this.spaceId, JSON.stringify(this.content), this.name, this.description, this.slug, JSON.stringify(this.settings), this.unlisted, this.lightmap_url],
    )
    return !!result?.rows[0]?.id
  }

  async updateSlug(slug: string) {
    const r = await db.query('embedded/update-space-slug', `select id from spaces where slug ILIKE $1 limit 1`, [slug])
    if (!!r.rows[0]?.id) {
      return { success: false }
    }
    this.slug = slug
    return { success: true }
  }

  updateSettings(body: Record<string, any>): { shouldUpdateMeta: boolean; shouldUpdateParcelScript: boolean } {
    let shouldUpdateMeta = false
    let shouldUpdateParcelScript = false
    if ('sandbox' in body) {
      this.settings.sandbox = !!body.sandbox
      shouldUpdateMeta = true
      shouldUpdateParcelScript = true
    }

    if ('hosted_scripts' in body) {
      this.settings.hosted_scripts = false // Spaces do not have hosted_scripts at the moment, but I don't nerf this as maybe they will in the future
      shouldUpdateParcelScript = true
    }

    return { shouldUpdateMeta, shouldUpdateParcelScript }
  }

  public addLastModifiedHeader(res: Response): void {
    if (!this.updated_at) return
    const updated = new Date(this.updated_at)
    if (!isNaN(updated.valueOf())) res.set('Last-Modified', updated.toUTCString())
  }
}
