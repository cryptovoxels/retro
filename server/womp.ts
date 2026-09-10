import db from './pg'

export enum WompType {
  Public = 'public',
  Broadcast = 'broadcast',
  ProfileOnly = 'profile',
  BugReport = 'report',
}

export default class Womp {
  id: number = undefined!
  content: string = undefined!
  author: string = undefined!
  coords: string = undefined!
  parcel_id: number | undefined
  space_id: string | undefined
  image: Uint8Array = undefined!
  image_url: string = undefined!
  kind: WompType = undefined!
  metadata: any = undefined!

  constructor(params?: any) {
    if (params) {
      Object.assign(this, params)
    }
  }

  static async loadFromId(id: number): Promise<Womp | null> {
    const res = await db.query('embedded/get-womp', `select * from womps where id=$1`, [id])

    if (!res.rows[0]) {
      return null
    }

    return new Womp(res.rows[0])
  }

  async create() {
    /* Check if user is spamming events */
    const latestWompsResponse = await db.query(
      'embedded/insert-womp',
      `
    select
      *
    from
      womps
    where
      lower(author) = lower($1) AND parcel_id=$2 AND created_at>(NOW() - INTERVAL '5 minutes')
    ORDER BY
      created_at desc
  `,
      [this.author, this.parcel_id],
    )

    if (latestWompsResponse.rows?.length > 3) {
      return { success: false, message: "You're doing this too much", closeUi: true }
    }

    const insertResponse = await db.query(
      'embedded/insert-womp-2',
      `
      insert into
        womps (author, content, coords, parcel_id, space_id, kind, image_url, metadata, created_at, updated_at)
      values
        ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      returning
        id
    `,
      [this.author, this.content, this.coords, this.parcel_id, this.space_id, this.kind, this.image_url, this.metadata ? JSON.stringify(this.metadata) : null],
    )

    this.id = insertResponse.rows[0].id
    return { success: true }
  }
}
