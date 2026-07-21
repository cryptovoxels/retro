import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './db'
import { importNdjson, ndjsonPath } from './import'
import { runPool, printStats } from './pool'

function dataDir(): string {
  return process.env.DATA_DIR || process.cwd()
}

function dbPath(): string {
  return process.env.DB_PATH || path.join(dataDir(), 'world.db')
}

function concurrency(): number {
  return parseInt(process.env.CONCURRENCY || '16', 10) || 16
}

function retries(): number {
  return parseInt(process.env.RETRIES || '3', 10) || 3
}

async function main() {
  const cmd = process.argv[2] || 'run'
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })
  const db = openDb(dbPath())

  if (cmd === 'import') {
    const ndjson = process.argv[3] || ndjsonPath(dir)
    await importNdjson(db, ndjson)
    printStats(db)
    return
  }

  if (cmd === 'run') {
    console.log(`DATA_DIR=${dir} CONCURRENCY=${concurrency()} RETRIES=${retries()}`)
    printStats(db)
    await runPool(db, dir, concurrency(), retries())
    printStats(db)
    return
  }

  if (cmd === 'stats') {
    printStats(db)
    return
  }

  if (cmd === 'export') {
    const rows = db.prepare(`SELECT id, name, address, island, lightmap_url, content FROM parcels ORDER BY id`).all() as any[]
    for (const r of rows) {
      const obj = {
        id: r.id,
        name: r.name,
        address: r.address,
        island: r.island,
        lightmap_url: r.lightmap_url,
        content: JSON.parse(r.content),
      }
      process.stdout.write(JSON.stringify(obj) + '\n')
    }
    return
  }

  console.error(`usage: world-dump.js <import|run|stats|export>`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
