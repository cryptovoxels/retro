import db from '../pg'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function runMigrations() {
  // bundled __dirname is server/, so ../ misses; cwd is repo root in prod + local
  const migrationSql = readFileSync(join(process.cwd(), 'server/migrations.sql'))
  await db.query('embedded/migration', migrationSql.toString())
  console.log('Migrations ran successfully')
}

if (require.main === module) {
  runMigrations()
    .catch((err) => console.error(err))
    .finally(() => process.exit())
}
