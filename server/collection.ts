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
}
