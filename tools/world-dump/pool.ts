import type { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { AssetRow } from './db'
import { download, findExistingBlob, readBlobHead } from './store'
import { rewriteParcelAsset, markParcelDoneIfReady, buildTryList } from './rewrite'
import { appendFailure } from './failures'
import { Kind, env, Env } from './resolve'
import { validatorFor } from './validate'
import { initDiscord, signDiscord } from './discord'

function optsFromParcel(db: DatabaseSync, parcelId: number, field: string): { transparent?: boolean; stretch?: boolean; assetUrl?: string | null } {
  const row = db.prepare('SELECT content FROM parcels WHERE id = ?').get(parcelId) as { content: string } | undefined
  if (!row) return {}
  try {
    const content = JSON.parse(row.content)
    const m = field.match(/^content\.features\[(\d+)\]/)
    if (m && content.features?.[parseInt(m[1], 10)]) {
      const f = content.features[parseInt(m[1], 10)]
      return {
        transparent: !!f.transparent,
        stretch: !!f.stretch,
        assetUrl: f.assetUrl || null,
      }
    }
  } catch {
    /* ignore */
  }
  return {}
}

function claimAsset(db: DatabaseSync): AssetRow | null {
  db.exec('BEGIN IMMEDIATE')
  try {
    // random offset so 2000 discord urls in a row don't hog every worker
    const off = (Math.random() * 5000) | 0
    const claim = db.prepare(`SELECT id, parcel_id, field, kind, raw_url, url, hash, status, error, tries FROM assets WHERE status = 'pending' ORDER BY id LIMIT 1 OFFSET ?`)
    const row = (claim.get(off) || claim.get(0)) as AssetRow | undefined
    if (!row) {
      db.exec('COMMIT')
      return null
    }
    db.prepare(`UPDATE assets SET status = 'fetching', tries = tries + 1, updated_at = datetime('now') WHERE id = ?`).run(row.id)
    db.exec('COMMIT')
    return row
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  }
}

function reclaimStuck(db: DatabaseSync): void {
  db.prepare(`UPDATE assets SET status = 'pending' WHERE status = 'fetching'`).run()
}

async function processOne(db: DatabaseSync, storeDir: string, dataDir: string, row: AssetRow, e: Env): Promise<'done' | 'failed' | 'skip'> {
  const isValid = validatorFor(row.kind as Kind)

  // lazy url dedupe — only reuse if blob on disk still passes validator
  const prior = db.prepare(`SELECT hash FROM assets WHERE url = ? AND status = 'done' AND hash IS NOT NULL LIMIT 1`).get(row.url) as { hash: string } | undefined

  if (prior?.hash) {
    const existing = findExistingBlob(storeDir, prior.hash)
    if (existing && fs.existsSync(existing) && isValid(readBlobHead(existing))) {
      db.prepare(`UPDATE assets SET status = 'done', hash = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`).run(prior.hash, row.id)
      rewriteParcelAsset(db, row.parcel_id, row.field, prior.hash)
      markParcelDoneIfReady(db, row.parcel_id)
      return 'done'
    }
  }

  const opts = optsFromParcel(db, row.parcel_id, row.field)
  let tryList = buildTryList(row.kind as Kind, row.raw_url, row.url, e, opts)
  // discord urls need a fresh signature or they 404
  tryList = await Promise.all(tryList.map(async (u) => (u.match(/discordapp\.(com|net)\/attachments/) ? (await signDiscord(u)) || u : u)))
  const [primary, ...rest] = tryList

  if (!primary) {
    // empty try list = page URL / nothing to fetch -> skip
    db.prepare(`UPDATE assets SET status = 'skip', error = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id)
    markParcelDoneIfReady(db, row.parcel_id)
    return 'skip'
  }

  try {
    const result = await download(primary, rest, isValid, storeDir)
    db.prepare(`UPDATE assets SET status = 'done', hash = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`).run(result.hash, row.id)
    rewriteParcelAsset(db, row.parcel_id, row.field, result.hash)
    markParcelDoneIfReady(db, row.parcel_id)
    return 'done'
  } catch (err: any) {
    const tried = err?.tried || [{ url: primary, error: err?.message || String(err) }]
    const errMsg = tried.map((t: any) => `${t.url} -> ${t.error}`).join('; ')
    db.prepare(`UPDATE assets SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`).run(errMsg.slice(0, 2000), row.id)
    appendFailure(dataDir, {
      parcelId: row.parcel_id,
      assetId: row.id,
      kind: row.kind,
      field: row.field,
      raw: row.raw_url,
      tried,
    })
    markParcelDoneIfReady(db, row.parcel_id)
    return 'failed'
  }
}

export async function runPool(db: DatabaseSync, dataDir: string, concurrency: number, _retries: number): Promise<void> {
  const storeDir = path.join(dataDir, 'store')
  const e = env()
  reclaimStuck(db)
  initDiscord(db)
  db.prepare(
    `UPDATE parcels SET done = 1 WHERE done = 0 AND id NOT IN (
      SELECT DISTINCT parcel_id FROM assets WHERE status NOT IN ('done','failed','skip')
    )`,
  ).run()

  // in-memory counters: the old per-completion SUM() over 500k rows was a
  // synchronous full table scan that blocked the event loop and serialized everything
  const start = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
      FROM assets`,
    )
    .get() as any
  let pending = start.pending || 0
  let done = start.done || 0
  let failed = start.failed || 0
  let active = 0
  let stop = false

  const tick = () => {
    process.stdout.write(`\rpending=${pending} fetching=${active} done=${done} failed=${failed}   `)
  }
  const timer = setInterval(tick, 1000)

  await new Promise<void>((resolve) => {
    const pump = () => {
      if (stop) return
      while (active < concurrency) {
        const row = claimAsset(db)
        if (!row) {
          if (active === 0) {
            stop = true
            clearInterval(timer)
            console.log('\nrun complete')
            resolve()
            return
          }
          break
        }
        pending--
        active++
        processOne(db, storeDir, dataDir, row, e)
          .then((r) => {
            if (r === 'done') done++
            else if (r === 'failed') failed++
          })
          .catch((err) => {
            console.error('\nworker error', err)
            pending++
            try {
              db.prepare(`UPDATE assets SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'fetching'`).run(row.id)
            } catch {
              /* ignore */
            }
          })
          .finally(() => {
            active--
            pump()
          })
      }
    }
    pump()
  })
}

export function printStats(db: DatabaseSync): void {
  const parcels = db.prepare(`SELECT COUNT(*) as c, SUM(done) as done FROM parcels`).get() as any
  const assets = db.prepare(`SELECT status, COUNT(*) as c FROM assets GROUP BY status ORDER BY status`).all() as { status: string; c: number }[]
  console.log(`parcels: ${parcels.c} (${parcels.done || 0} done)`)
  for (const a of assets) {
    console.log(`  assets ${a.status}: ${a.c}`)
  }
}
