/**
 * Migration: convert driveable megavox features into ride features.
 *
 * Rules (locked product decisions):
 * - in place: same uuid, type becomes 'ride'
 * - hard cap 5 rides per parcel: first 5 driveable megavoxes convert
 * - extras stay megavox with driveable/flyable/seat/yaw stripped
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/migrate-driveable-to-ride.ts
 *   DATABASE_URL=postgres://... npx ts-node scripts/migrate-driveable-to-ride.ts --dry-run
 *   node scripts/migrate-driveable-to-ride.selftest.mjs
 */

import { Pool } from 'pg'

const dry = process.argv.includes('--dry-run')
export const RIDE_CAP = 5

export function stripDriveFields(f: any) {
  const { driveable, flyable, driveYawOffset, driveSeatOffset, ...rest } = f
  return rest
}

export function migrateFeatures(features: any[]): { features: any[]; converted: number; stripped: number } {
  if (!Array.isArray(features)) return { features, converted: 0, stripped: 0 }

  let converted = 0
  let stripped = 0
  const out = features.map((f) => {
    if (!f || f.type !== 'megavox' || !f.driveable) return f

    if (converted < RIDE_CAP) {
      converted++
      const next = { ...f, type: 'ride', collidable: true }
      delete next.driveable
      // keep flyable / driveYawOffset / driveSeatOffset on ride
      return next
    }

    stripped++
    return stripDriveFields(f)
  })

  return { features: out, converted, stripped }
}

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgres://localhost/voxels'
  const pool = new Pool({
    connectionString: connectionString.replace(/^postgresql:\/\//, 'postgres://'),
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  })

  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ id: number; content: any }>(`select id, content from properties where content is not null and content::text like '%"driveable"%'`)

    console.log(`Found ${rows.length} parcels with driveable in content`)

    let parcelsTouched = 0
    let totalConverted = 0
    let totalStripped = 0

    for (const row of rows) {
      const content = row.content
      if (!content?.features) continue

      const { features, converted, stripped } = migrateFeatures(content.features)
      if (!converted && !stripped) continue

      parcelsTouched++
      totalConverted += converted
      totalStripped += stripped
      console.log(`  parcel ${row.id}: converted ${converted}, stripped ${stripped}`)

      if (dry) continue

      content.features = features
      await client.query(`update properties set content = $1 where id = $2`, [JSON.stringify(content), row.id])
    }

    console.log(`Done. parcels=${parcelsTouched} converted=${totalConverted} stripped=${totalStripped}${dry ? ' (dry-run)' : ''}`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
