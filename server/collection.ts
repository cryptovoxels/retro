import { isEqual } from 'lodash'
import { isMod } from './lib/helpers'
import { isCollectionIDAlreadyOnChain } from './lib/ethereum-helpers'
import db from './pg'

export default class Collection {
  id: number | null = null
  name: string | null = null
  description: string | null = null
  image_url: string | null = null
  owner: string | null = null
  address: string | null = null
  slug: string | null = null
  type: string | null = null
  suppressed: boolean | null = null
  chainId: number | null = null
  collectiblesType: string | null = null
  customAttributesNames: any
  settings: any
  discontinued: boolean | null = null

  constructor(params?: Partial<Collection & { chainid: number }>) {
    if (params) {
      this.chainId = params.chainId || params.chainid || null // chainid is from psql
      this.collectiblesType = params.collectiblesType || 'wearables'
      this.customAttributesNames = this.collectiblesType !== 'wearables' ? null : params.customAttributesNames // other types of collectible should not support custom traits
      Object.assign(this, params)
    }
  }

  static async loadFromId(id: number): Promise<Collection | null> {
    const res = await db.query('embedded/get-collection', `select * from collections where id=$1`, [id])

    if (!res.rows[0]) {
      return null
    }

    return new Collection(res.rows[0])
  }

  static async loadFromChainInfo(chainid: number, address: string): Promise<Collection | null> {
    const res = await db.query('embedded/get-collection', `select * from collections where chainid=$1 and lower(address)=$2`, [chainid, address.toLowerCase()])

    if (!res.rows[0]) {
      return null
    }

    return new Collection(res.rows[0])
  }
  async create() {
    /* Check if collection already exists */
    const res1 = await db.query(
      'embedded/create-collection',
      `
    select
      *
    from
      collections
    where
      slug=$1 AND chainid = $2
  `,
      [this.slug, this.chainId],
    )

    if (res1.rows[0]) {
      this.id = res1.rows[0].id
      return res1.rows[0].id
    }

    const res = await db.query(
      'embedded/create-collection-2',
      `
      insert into
        collections (name, description, image_url, owner, type, slug, chainid, collectibles_type)
      values
        ($1, $2, $3, $4, $5, $6, $7, $8)
      returning
        id
    `,
      [this.name, this.description, this.image_url, this.owner, this.type, this.slug, this.chainId, this.collectiblesType],
    )

    this.id = res.rows[0].id

    return this.id
  }

  async remove() {
    const res = await db.query(
      'embedded/delete-collection',
      `
    DELETE FROM
      collections
    WHERE
      id = $1 and lower(owner) = lower($2)
    returning
      id
  `,
      [this.id, this.owner],
    )

    db.query(
      'embedded/delete-wearables-by-collection',
      `
    DELETE FROM
      wearables
    WHERE
      collection_id = $1 and token_id is null
  `,
      [this.id],
    )
    return { success: !!res.rows[0]?.id }
  }

  async discontinue() {
    const res1 = await db.query(
      'embedded/discontinue-collection',
      `
    select
      *
    from
      collections
    where
      discontinued = false AND lower(owner)=lower($1) AND id=$2
  `,
      [this.owner, this.id],
    )

    if (res1.rows[0]) {
      this.id = res1.rows[0].id

      await db.query(
        'embedded/discontinue-collection-2',
        `
      update collections
    set discontinued = true
    WHERE
      id = $1
    returning
      id
  `,
        [this.id],
      )

      db.query(
        'embedded/delete-wearables-by-collection-2',
        `
    DELETE FROM
      wearables
    WHERE
      collection_id = $1 and token_id is null
  `,
        [this.id],
      )
    }
  }

  async update() {
    // Get previous version

    if (!this.id) {
      throw new Error('Collection id is required')
    }

    const oldVersion = await Collection.loadFromId(this.id)

    if (!oldVersion) {
      return { success: false }
    }

    // Hack to get if the user is a mod or not See isMod()
    const r = { user: { wallet: this.owner ?? '' } }

    if (this.owner?.toLowerCase() !== oldVersion.owner?.toLowerCase() && !isMod(r)) {
      return { success: false }
    }

    this.id = oldVersion.id

    let k = 0
    let query = 'update collections set'

    if (oldVersion.name != this.name) {
      k++
      query += ` name='${this.name ? escapeHtml(this.name) : ''}'` //await pg.query(`update collections set name=$1 where id=$2`, [this.name, this.id])
    }
    if (oldVersion.description != this.description) {
      if (k > 0) {
        query += `, description='${this.description ? escapeHtml(this.description) : ''}'`
      } else {
        k++
        query += ` description='${this.description ? escapeHtml(this.description) : ''}'`
      }
    }

    if (!!this.image_url && oldVersion.image_url != this.image_url) {
      if (k > 0) {
        query += `, image_url='${this.image_url.toString()}'`
      } else {
        k++
        query += ` image_url='${this.image_url.toString()}'`
      }
    }
    if (!isEqual(oldVersion.settings, this.settings)) {
      if (k > 0) {
        query += `, settings=coalesce('${JSON.stringify(this.settings)}'::json,settings)`
      } else {
        k++
        query += ` settings=coalesce('${JSON.stringify(this.settings)}'::json,settings)`
      }
    }
    if (!isEqual(oldVersion.customAttributesNames, this.customAttributesNames)) {
      const stringified = this.customAttributesNames
        .map((trait: any) => {
          return `'${JSON.stringify(trait)}'::json`
        })
        .join(',')
      if (k > 0) {
        query += `, custom_attributes_names=${this.customAttributesNames.length == 0 ? `'{}'` : `ARRAY[${stringified}]`}`
      } else {
        k++
        query += ` custom_attributes_names=${this.customAttributesNames.length == 0 ? `'{}'` : `ARRAY[${stringified}]`}`
      }
    }
    query += ` where id=${this.id};`
    if (k > 0) {
      await db.query(
        'embedded/update-collection-dynamic',

        query,
      )
      return { success: true, collection: this }
    }
    return { success: false }
  }

  async updateAddress() {
    // Should be called once.
    // Get previous version
    const res = await db.query(
      'embedded/update-collection-address',

      `
    update collections
      set
      address = $2
    where
      id = $1
      and address is null
      returning
      id`,
      [this.id, this.address],
    )
    const success = !!res.rows[0]?.id
    return { success }
  }

  async transferOwner(newOwner: string) {
    const res1 = await db.query(
      'embedded/get-collection',
      `
    select
      *
    from
      collections
    where
      id = $1`,
      [this.id],
    )
    const oldVersion = res1 && res1.rows && res1.rows[0]

    if (!oldVersion) {
      return { success: false }
    }

    if (newOwner.toLowerCase() == oldVersion.owner.toLowerCase()) {
      return { success: false }
    }

    this.id = oldVersion.id

    const query = 'update collections set owner = $1 where id=$2 returning id'

    const res = await db.query('embedded/update-collection-owner', query, [newOwner, this.id])
    return { success: !!res && !!res.rows[0], collection: this }
  }

  async toggleSuppress() {
    this.suppressed = !this.suppressed

    await db.query(
      'embedded/toggle-collection-suppressed',
      `
      update collections set suppressed=$1 where id=$2
`,
      [this.suppressed, this.id],
    )
  }
}

function escapeHtml(unsafe: string) {
  return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

async function nextCollectionId(index = 0): Promise<number> {
  const res = await db.query('embedded/get-next-collection-id', `select currval('collections_id_seq'::regclass)::integer+$1::integer as new_id;`, [index])
  const id = res.rows[0]?.new_id
  if (!id) {
    throw new Error('No Id')
  }

  return id
}
