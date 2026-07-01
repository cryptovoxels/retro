import db from './pg'

// same normalization the island slug routes use (get-island.sql): lowercase, trim, spaces -> hyphens.
const ISLAND_SLUG = `regexp_replace(lower(trim(coalesce(island, ''))), '\\s+', '-', 'g')`

// only landowners on the island (a minted, non-common parcel they own) may post to its board.
export async function ownsParcelOnIsland(wallet: string, slug: string): Promise<boolean> {
  const res = await db.query(
    'embedded/owns-parcel-on-island',
    `select 1 from properties
     where lower(owner) = lower($1)
       and minted = true
       and is_common <> true
       and ${ISLAND_SLUG} = $2::text
     limit 1`,
    [wallet, slug],
  )
  return (res.rows?.length ?? 0) > 0
}

export default class IslandPost {
  id: number = undefined!
  island: string = undefined!
  author: string = undefined!
  content: string = undefined!

  constructor(params?: any) {
    if (params) Object.assign(this, params)
  }

  async create() {
    const recent = await db.query(
      'embedded/island-post-ratelimit',
      `select id from island_posts
       where lower(author) = lower($1) and island = $2 and created_at > (NOW() - INTERVAL '5 minutes')`,
      [this.author, this.island],
    )

    if ((recent.rows?.length ?? 0) > 5) {
      return { success: false, message: "You're doing this too much", closeUi: true }
    }

    const inserted = await db.query(
      'embedded/insert-island-post',
      `insert into island_posts (island, author, content, created_at)
       values ($1, $2, $3, NOW()) returning id`,
      [this.island, this.author, this.content],
    )

    this.id = inserted.rows[0].id
    return { success: true }
  }
}
