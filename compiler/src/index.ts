// ABOUTME: Background parcel compiler - multi-parcel farm, shared 40 fetchers, IRC board.

import './bootstrap'
import express from 'express'
import { type CompilePools } from '../../common/helpers/parcel-compile'
import db from '../../server/pg'
import { Board } from './board'
import { compileOne } from './parcel'
import { createFarm } from './farm'
import { hoardEnabled } from './hoard'

const port = process.env.PORT || '8081'
const SLEEP_MS = parseInt(process.env.COMPILE_SLEEP_MS || '0', 10)
const COMPILE_PARCELS = parseInt(process.env.COMPILE_PARCELS || '16', 10)
const COMPILE_WORKERS = parseInt(process.env.COMPILE_WORKERS || '40', 10)
// COMPILE_REPROCESS=1 or --reprocess: every parcel, drafts only, no UGC PUTs, exit when done
const REPROCESS = process.env.COMPILE_REPROCESS === '1' || process.argv.includes('--reprocess')
const parcelArg = process.argv.indexOf('--parcel')
const parcelId = parcelArg < 0 ? undefined : Number(process.argv[parcelArg + 1])

const app = express()

app.get('/health', (_req, res) => {
  res.status(200).end('up')
})

const farm = createFarm(COMPILE_PARCELS, COMPILE_WORKERS)
const board = new Board(COMPILE_WORKERS, COMPILE_PARCELS)

const pools: CompilePools = {
  download: (fn) => farm.downloaders.run(fn),
  upload: (fn) => farm.uploaders.run(fn),
}

const seen = new Set<number>()
const queue: number[] = []
const picking = { lock: Promise.resolve() }
let exhausted = false
let inFlight = 0

// the where clause is a full table text scan, so grab the lowest 100 in one go and hand them out shuffled
async function pickParcelId(): Promise<number | null> {
  picking.lock = picking.lock.then(async () => {
    if (queue.length) return
    if (exhausted) return
    const r = REPROCESS
      ? await db.query(
          'embedded/pick-all-parcels',
          `select id from properties
            where not (id = any($1::int[]))
            order by id
            limit 100`,
          [Array.from(seen)],
        )
      : await db.query(
          'embedded/pick-uncompiled-parcels',
          `select id from properties
            where (compiled_at is null or updated_at > compiled_at)
              and not (id = any($1::int[]))
            order by compiled_at nulls first, id
            limit 100`,
          [Array.from(seen)],
        )
    if (!r.rows.length) {
      exhausted = true
      return
    }
    for (const row of r.rows) {
      if (typeof row.id !== 'number' || seen.has(row.id)) continue
      seen.add(row.id)
      queue.splice(Math.floor(Math.random() * (queue.length + 1)), 0, row.id)
    }
  })
  // a failed query must not poison the lock chain for every later pick
  await picking.lock.catch((e) => console.error('[compiler] pick', e))
  return queue.shift() ?? null
}

// a js death must not look like an oom kill: stop the board so the stack survives the redraw, then die loud
for (const ev of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(ev, (e) => {
    board.stop()
    console.error(`[compiler] ${ev}`, e)
    process.exit(1)
  })
}

const abort = new AbortController()

async function workerLoop() {
  while (!abort.signal.aborted) {
    const id = await pickParcelId()
    if (!id) {
      if (REPROCESS && exhausted && inFlight === 0 && !queue.length) {
        board.stop()
        console.error(`[compiler] reprocess done  ${seen.size} parcels`)
        process.exit(0)
      }
      await new Promise((r) => setTimeout(r, Math.max(SLEEP_MS, 1000)))
      continue
    }
    inFlight++
    try {
      await farm.compilers.run(async () => {
        await compileOne(id, { pools, board, reprocess: REPROCESS })
      })
    } catch (e) {
      board.logDone(`#${id} boom ${e}`)
      console.error('[compiler]', id, e)
    } finally {
      inFlight--
    }
    if (SLEEP_MS > 0) await new Promise((r) => setTimeout(r, SLEEP_MS))
  }
}

// One parcel, same compiler and backup recovery, then exit. No world scan or HTTP listener.
if (parcelArg >= 0) {
  if (!Number.isSafeInteger(parcelId) || parcelId! <= 0 || REPROCESS) {
    console.error('usage: tsx compiler/src/index.ts --parcel <id> (without --reprocess)')
    process.exit(1)
  }
  board.start()
  compileOne(parcelId!, { pools, board })
    .then(() => {
      board.stop()
      process.exit(0)
    })
    .catch((e) => {
      board.stop()
      console.error('[compiler]', parcelId, e)
      process.exit(1)
    })
} else
  app.listen(port, () => {
    board.start()
    for (let i = 0; i < COMPILE_PARCELS; i++) void workerLoop()
    console.error(
      `[compiler] listening on ${port}  parcels=${COMPILE_PARCELS} workers=${COMPILE_WORKERS}  hoard=${!REPROCESS && hoardEnabled() ? 'on' : 'off'}  mode=${REPROCESS ? 'REPROCESS (all parcels, drafts only, no ugc put)' : 'compile'}`,
    )
  })
