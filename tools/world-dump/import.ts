import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { DatabaseSync } from 'node:sqlite'
import { extractAssets } from './extract'
import { env } from './resolve'

export async function importNdjson(db: DatabaseSync, ndjsonPath: string): Promise<{ parcels: number; assets: number; skipped: number }> {
  if (!fs.existsSync(ndjsonPath)) {
    throw new Error(`missing ${ndjsonPath}`)
  }

  const e = env()
  const insertParcel = db.prepare(`
    INSERT OR IGNORE INTO parcels (id, name, address, island, content, done)
    VALUES (?, ?, ?, ?, ?, 0)
  `)
  const insertAsset = db.prepare(`
    INSERT OR IGNORE INTO assets (parcel_id, field, kind, raw_url, url, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const exists = db.prepare('SELECT 1 FROM parcels WHERE id = ?')

  let parcels = 0
  let assets = 0
  let skipped = 0
  let bad = 0

  const stream = fs.createReadStream(ndjsonPath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  db.exec('BEGIN')
  let batch = 0

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parcel: any
    try {
      parcel = JSON.parse(trimmed)
    } catch {
      bad++
      continue
    }

    if (!parcel.id) continue

    if (exists.get(parcel.id)) {
      skipped++
      continue
    }

    // content may be object (old dumps) or JSON string (new dumps - safer NDJSON)
    let contentObj: any = parcel.content ?? {}
    if (typeof contentObj === 'string') {
      try {
        contentObj = JSON.parse(contentObj)
      } catch {
        bad++
        continue
      }
    }
    const content = JSON.stringify(contentObj)
    insertParcel.run(parcel.id, parcel.name ?? null, parcel.address ?? null, parcel.island ?? null, content)
    parcels++

    const refs = extractAssets({ ...parcel, content: contentObj }, e)
    for (const ref of refs) {
      insertAsset.run(parcel.id, ref.field, ref.kind, ref.raw_url, ref.url, ref.status)
      assets++
    }

    batch++
    if (batch % 200 === 0) {
      db.exec('COMMIT')
      db.exec('BEGIN')
      console.log(`import: ${parcels} parcels, ${assets} assets, ${bad} bad lines...`)
    }
  }

  db.exec('COMMIT')
  console.log(`import done: ${parcels} parcels, ${assets} assets, ${skipped} already present, ${bad} bad lines skipped`)
  return { parcels, assets, skipped }
}

export function ndjsonPath(dataDir: string): string {
  const candidates = [path.join(dataDir, 'parcels.ndjson'), path.join(dataDir, 'parcels.ndjson.gz')]
  for (const c of candidates) {
    if (fs.existsSync(c) && !c.endsWith('.gz')) return c
  }
  return path.join(dataDir, 'parcels.ndjson')
}
