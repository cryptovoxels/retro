import db from './pg'

// same normalization the island slug routes use (get-island.sql): lowercase, trim, spaces -> hyphens.
const islandSlug = (col: string) => `regexp_replace(lower(trim(coalesce(${col}, ''))), '\\s+', '-', 'g')`

export type IslandParcel = { id: number; name: string | null; address: string }

// minted, non-common parcels on this island the wallet owns or collaborates on. posting rights
// and the optional "signed by parcel" picker both come from this list.
export async function ownedParcelsOnIsland(wallet: string, slug: string): Promise<IslandParcel[]> {
  const res = await db.query(
    'embedded/owned-parcels-on-island',
    `select p.id, p.name, p.address from properties p
     where p.minted = true
       and p.is_common <> true
       and ${islandSlug('p.island')} = $2::text
       and (
         lower(p.owner) = lower($1)
         or exists (
           select 1 from parcel_users pu
           where pu.parcel_id = p.id
             and lower(pu.wallet) = lower($1)
             and pu.role <> 'excluded'
         )
       )
     order by p.id`,
    [wallet, slug],
  )
  return (res.rows ?? []) as IslandParcel[]
}

// owners and collaborators on a minted, non-common parcel on this island may post to its board.
export async function ownsParcelOnIsland(wallet: string, slug: string): Promise<boolean> {
  return (await ownedParcelsOnIsland(wallet, slug)).length > 0
}

export default class IslandPost {
  id: number = undefined!
  island: string = undefined!
  author: string = undefined!
  content: string = undefined!
  parcelId: number | null = null

  constructor(params?: any) {
    if (params) Object.assign(this, params)
  }

  // every wallet has one slot per island: posting again replaces the note (same row, bumped
  // created_at) and resets its hearts - a bump costs the acknowledgment the old note earned.
  async create() {
    const existing = await db.query('embedded/island-post-slot', `select id, created_at from island_posts where island = $1 and lower(author) = lower($2)`, [this.island, this.author])

    const slot = existing.rows?.[0]
    if (slot && Date.now() - new Date(slot.created_at).getTime() < 60_000) {
      return { success: false, message: 'you just posted - give it a minute' }
    }

    const upserted = await db.query(
      'embedded/upsert-island-post',
      `insert into island_posts (island, author, content, parcel_id, created_at)
       values ($1, $2, $3, $4, NOW())
       on conflict (island, (lower(author)))
       do update set content = excluded.content, parcel_id = excluded.parcel_id, author = excluded.author, created_at = NOW()
       returning id`,
      [this.island, this.author, this.content, this.parcelId],
    )

    this.id = upserted.rows[0].id
    if (slot) {
      await db.query('embedded/reset-island-post-hearts', `delete from island_post_hearts where post_id = $1`, [this.id])
    }
    return { success: true }
  }
}
