import db from './pg'

export default class VEvent {
  id?: number
  author?: string
  name?: string
  description?: string
  color?: string
  parcel_id?: number
  location?: string
  timezone?: string
  starts_at?: Date
  expires_at?: Date
  created_at?: string | number | Date

  constructor(params?: any) {
    if (params) {
      Object.assign(this, params)
    }
  }

  static async loadFromId(id: number): Promise<VEvent | null> {
    const res = await db.query('embedded/get-parcel-event', `select * from parcel_events where id=$1`, [id])
    if (!res.rows[0]) return null
    return new VEvent(res.rows[0])
  }

  isValid(): { valid: boolean; message: string } {
    if (!this.starts_at) return { valid: false, message: 'missing start date' }
    if (!this.expires_at) return { valid: false, message: 'missing end date' }
    if (!this.name?.trim()) return { valid: false, message: 'missing name' }

    const duration = (new Date(this.expires_at).getTime() - new Date(this.starts_at).getTime()) / 1000

    if (duration < 60) return { valid: false, message: "duration can't be less than a minute" }
    if (duration > 7 * 3600 * 24) return { valid: false, message: "duration can't be more than a week" }

    return { valid: true, message: '' }
  }

  async create() {
    const res = await db.query(
      'embedded/insert-parcel-event',
      `INSERT INTO parcel_events (parcel_id, author, name, description, color, location, created_at, timezone, starts_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, COALESCE($8, NOW()), COALESCE($9, (NOW() + INTERVAL '1 hour')))
       RETURNING id`,
      [this.parcel_id, this.author, this.name, this.description, this.color, this.location, this.timezone, this.starts_at, this.expires_at],
    )
    if (!res.rows[0]) return { success: false, message: 'Something went wrong' }
    this.id = res.rows[0].id
    return { success: true, id: this.id }
  }

  async remove() {
    const res = await db.query('embedded/delete-parcel-event', `DELETE FROM parcel_events WHERE id = $1 RETURNING id`, [this.id])
    return { success: !!res.rows[0]?.id, id: res.rows[0]?.id }
  }

  async update() {
    const res = await db.query(
      'embedded/update-parcel-event',
      `UPDATE parcel_events
       SET name = $2, description = $3, color = $4, timezone = $5,
           starts_at = COALESCE($6, NOW()), expires_at = COALESCE($7, (NOW() + INTERVAL '1 hour')),
           location = $8
       WHERE id = $1
       RETURNING id`,
      [this.id, this.name, this.description, this.color, this.timezone, this.starts_at, this.expires_at, this.location],
    )
    return { success: !!res.rows[0]?.id, id: res.rows[0]?.id }
  }
}
