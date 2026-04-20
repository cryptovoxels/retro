import Collectible from './collectible'

import db from './pg'

export enum WearableCategory {
  Accessory = 'accessory',
  Headwear = 'headwear',
  Facewear = 'facewear',
  Upperbody = 'upperbody',
  Lowerbody = 'lowerbody',
  Feet = 'feet',
  Arms = 'arms',
  Hands = 'hands',
}

export default class Wearable extends Collectible {
  id: string | undefined = undefined // is a UUID
  issues: number | undefined = undefined
  data: Uint8Array | undefined = undefined
  hash: string | undefined = undefined
  token_id: number | undefined = undefined
  custom_attributes?: any
  category: WearableCategory = WearableCategory.Headwear
  collection_id: number | undefined = undefined

  constructor(params?: Partial<Wearable>) {
    super()
    this.tableName = 'wearables'
    if (params) {
      Object.assign(this, params)
    }
  }

  /**
   * Returns the rarity of the wearable
   * Returns {string}
   */
  get rarity() {
    if (!this.issues) return 'common'

    if (this.issues < 10) {
      return 'legendary'
    } else if (this.issues < 100) {
      return 'epic'
    } else if (this.issues < 1000) {
      return 'rare'
    } else {
      return 'common'
    }
  }

  /**
   * Save the wearables' token id and image if any.
   */
  async saveTokenId() {
    const r = await db.query('embedded/update-wearable-token', `update wearables set token_id=$1,updated_at=now() where id=$2 returning id`, [this.token_id, this.id])
    const id = r.rows && r.rows[0].id
    return { success: !!id, ...(!id && { message: '❌ Something went wrong while saving your collectible.' }) }
  }

  /**
   * Mark an off-chain wearable as "accepted" or "fake minted"
   */
  async generateTokenId(): Promise<{ success: boolean; token_id?: number; message?: string }> {
    const r = await db.query(
      'embedded/update-off-chain-wearable-token',
      `
      with new_id as (
        select coalesce(max(token_id),0)+1 as value from wearables where collection_id = $2 and token_id is not null
      )
      update wearables set token_id=new_id.value, updated_at=now() from new_id where id=$1 returning token_id`,
      [this.id, this.collection_id],
    )
    const token_id = r.rows && r.rows[0].token_id
    this.token_id = token_id
    return { success: !!token_id, token_id, ...(!token_id && { message: '❌ Something went wrong while saving your collectible.' }) }
  }
  /**
   * Set rejected_at of a wearable given collection_id and id (uuid)
   */
  async setCustomAttributes() {
    const r = await db.query('embedded/update-wearable-custom-attributes', `update wearables set custom_attributes=$1 where id=$2 returning id`, [this.custom_attributes, this.id])
    const id = r.rows && r.rows[0].id

    return { success: !!id, ...(!id && { message: '❌ Could not set custom attributes' }) }
  }

  /**
   * Load the collectible given the token_id and a collection_id
   * @param token_id token_id of the collectible
   * @param collection_id collection_id of the collectible
   * Returns {Collectible}
   */
  static async loadFromTokenIdAndCollectionId(token_id: number, collection_id: number): Promise<Wearable | null> {
    if (isNaN(token_id) || isNaN(collection_id)) {
      return null
    }
    if (!Number.isSafeInteger(token_id) || !Number.isSafeInteger(collection_id)) {
      return null
    }

    try {
      let res = await db.query(
        'sql/get-wearable-by-ids',
        `
        select
          *
        from
          wearables
        where
          token_id=$1 and collection_id=$2
      `,
        [token_id, collection_id],
      )
      return new Wearable(res.rows[0])
    } catch (e) {
      console.error(e)
      return null
    }
  }

  /**
   * Load the Wearable given the id (uuid) of the wearable
   * @param id the uuid of the wearable
   * Returns {Wearable}
   */
  static async loadFromId(id: string): Promise<Wearable | null> {
    const res = await db.query(
      'embedded/get-wearable',
      `select *
    from wearables
    where id=$1`,
      [id],
    )

    if (!res.rows[0]) {
      return null
    }

    return new Wearable(res.rows[0])
  }
  /**
   * Load the Wearable given the id (uuid) of the wearable
   * @param chainid the chain ID 137=matic; 1=eth
   * @param address the address of the collection;
   * @param tokenId The tokenId;
   * Returns {Wearable}
   */
  static async loadFromChainInfo(chainid: number, address: string, tokenId: number): Promise<Wearable | null> {
    const res = await db.query(
      'embedded/get-wearable-from-chaininfo',
      `select wearables.*
    from wearables
    inner join 
      collections
      on wearables.collection_id = collections.id
    where lower(collections.address)=$2 and collections.chainid=$1 and token_id=$3`,
      [chainid, address.toLowerCase(), tokenId],
    )

    if (!res.rows[0]) {
      return null
    }

    return new Wearable(res.rows[0])
  }
  /**
   * Load the wearable from Wearable collection 1, given the token_id of the wearable.
   * @param token_id The token_id of the wearable
   * Returns {Wearable} from collection 1
   */
  static async loadFromTokenId(token_id: number): Promise<Wearable | null> {
    const res = await db.query(
      'embedded/get-wearable-by-token-id',
      `
    select *
from wearables
where token_id=$1 and collection_id=1`,
      [token_id],
    )

    if (!res.rows[0]) {
      return null
    }

    return new Wearable(res.rows[0])
  }

  /**
   * Load the wearable given its hash.
   * @param hash The hash of the wearable
   * Returns {Wearable}
   */
  static async loadFromHash(hash: string): Promise<Wearable | null> {
    const res = await db.query('embedded/get-wearable-by-hash', `select * from wearables where hash=$1 limit 1 `, [hash])

    if (!res.rows[0]) {
      return null
    }

    return new Wearable(res.rows[0])
  }

  /**
   * Create a wearable on the database
   * Returns void
   */
  create = async () => {
    const res = await db.query(
      'embedded/insert-wearable',
      `
      insert into
        wearables (name, description, author, issues, data, collection_id, custom_attributes, category)
      values
        ($1, $2, $3, $4, $5, $6, $7, $8)
      returning
        id;
    `,
      [this.name, this.description, this.author, this.issues, this.data, this.collection_id, this.custom_attributes, this.category],
    )

    this.id = res.rows[0]?.id
    let res2
    try {
      res2 = await db.query(
        'embedded/update-wearable-hash',

        `update wearables set hash = encode(digest(data, 'sha1'), 'hex') where id=$1 and collection_id=$2 returning hash`,
        [this.id, this.collection_id],
      )
    } catch {
      return { success: false, message: 'Could not generate a hash for this wearable' }
    }
    this.hash = res2.rows[0]?.hash

    // hash check to verify if that wearable has already been submitted or not
    // This check somehow cannot be done before creating the wearables; `encode(digest(data, 'sha1'), 'hex')` returns something different.
    const hashCheck = await db.query('embedded/get-wearable-by-hash', `select * from wearables where id <> $1 and hash=$2`, [this.id, this.hash])

    if (hashCheck?.rows[0]) {
      this.delete()
      return { success: false, message: 'This wearable has already been submitted (same Vox model)' }
    }

    return { success: true }
  }

  /**
   * set name or description or category
   */
  async update() {
    if (!this.tableName) {
      return
    }
    const r = await db.query(`embedded/update-wearable/${this.tableName}`, `update ${this.tableName} set name=$1, description=$2, category=$3 where id=$4 returning id`, [this.name, this.description, this.category, this.id])
    const id = r.rows && r.rows[0].id
    return { success: !!id, ...(!id && { message: '❌ Could not update NFT.' }) }
  }

  static async validateHashWearable(id: string, hash: string, author: string) {
    const r = await db.query('embedded/select-wearable-by-id-hash-author', `select * from wearables where id <> $1 and hash=$2 and lower(author) <> lower($3) and token_id is not null`, [id, hash, author])
    const collectible = r.rows && r.rows[0]
    return { success: !!collectible, collectible: collectible }
  }
}
