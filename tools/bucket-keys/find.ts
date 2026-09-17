// ABOUTME: Check which hoard keys exist for a url, against keys.sqlite from dump.sh. Same formulas the compiler uses.
//
// usage: npx tsx tools/bucket-keys/find.ts <url> [more ...]

import { execFileSync } from 'child_process'
import { join } from 'path'
import { hoardKeys } from '../../compiler/src/hoard'

const DB = join(__dirname, 'keys.sqlite')

for (const url of process.argv.slice(2)) {
  const list = hoardKeys(url)
    .map((k) => `'${k.key.replace(/'/g, "''")}'`)
    .join(',')
  const hits = execFileSync('sqlite3', ['-tabs', DB, `select bucket,key,size from keys where key in (${list}) and size > 0`], { encoding: 'utf8' }).trim()
  console.log(`${hits ? 'HIT ' : 'MISS'} ${url}`)
  if (hits) console.log(hits.replace(/^/gm, '     '))
}
