import db from './pg'

interface Island {
  id: number
  name: string
  texture?: string
  content?: any
  position?: any
}

export class Islands {
  static async fetch() {
    const result = await db.query(
      'embedded/get-islands',
      `
    select
      id,
      name,
      texture,
      content,
      position_json as position
    from
      islands
    order by
      id asc;
    `,
    )
    return result.rows as Island[]
  }
}
