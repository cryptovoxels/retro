import db from '../pg'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function runMigrations() {
  const migrationSql = readFileSync(join(__dirname, '../migrations.sql'))
  await db.query('embedded/migration', migrationSql.toString())
  console.log('Migrations ran successfully')
}

if (require.main === module) {
  runMigrations()
    .catch((err) => console.error(err))
    .finally(() => process.exit())
}
