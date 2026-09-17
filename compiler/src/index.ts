// ABOUTME: Background parcel compiler - multi-parcel farm, shared 40 fetchers, IRC board.

import './bootstrap'
import express from 'express'
import { compileParcelContent, type CompilePools } from '../../common/helpers/parcel-compile'
import Parcel from '../../server/parcel'
import db from '../../server/pg'
import { Board } from './board'
import { encodeImageDraft, encodeVoxDraft } from './drafts'
import { createFarm } from './farm'
import { hoardEnabled, hoardFetch } from './hoard'
import { serverUpload } from './upload'
import { encodeVoxelbr } from './voxelbr'

const port = process.env.PORT || '8081'
const SLEEP_MS = parseInt(process.env.COMPILE_SLEEP_MS || '0', 10)
const COMPILE_PARCELS = parseInt(process.env.COMPILE_PARCELS || '16', 10)
const COMPILE_WORKERS = parseInt(process.env.COMPILE_WORKERS || '40', 10)
// COMPILE_REPROCESS=1 or --reprocess: every parcel, drafts only, no UGC PUTs, exit when done
const REPROCESS = process.env.COMPILE_REPROCESS === '1' || process.argv.includes('--reprocess')

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
            where (content::text not like '%ugc://parcel/%' or json_array_length(coalesce(content->'missing', '[]'::json)) > 0)
              and not (id = any($1::int[]))
            order by content::text like '%ugc://parcel/%', id
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

function applyPatch(content: any, patch: Awaited<ReturnType<typeof compileParcelContent>>['patch']) {
  if (patch.features && Array.isArray(content.features)) {
    for (const f of content.features) {
      if (f?.uuid && patch.features[f.uuid]) Object.assign(f, patch.features[f.uuid])
    }
  }
  if (patch.tileset !== undefined) content.tileset = patch.tileset
}

async function compileOne(id: number) {
  board.addParcel(id)
  try {
    const parcel = await Parcel.load(id)
    if (!parcel?.content) return

    const features = (parcel.content.features || []).filter((f: any) => f && f.uuid)
    const tileset = parcel.content.tileset as string | undefined
    // reprocess never writes the bucket; normal mode uploads as usual
    const upload = REPROCESS ? async () => null : (name: string, bytes: Uint8Array, contentType: string, contentEncoding?: string) => serverUpload(id, name, bytes, contentType, contentEncoding)

    const { patch, missing } = await compileParcelContent(
      id,
      features,
      tileset,
      upload,
      {
        encodeImage: encodeImageDraft,
        encodeVox: encodeVoxDraft,
        encodeVoxelbr: REPROCESS ? undefined : encodeVoxelbr,
      },
      { pools, board, hoard: !REPROCESS && hoardEnabled() ? hoardFetch : undefined, reprocess: REPROCESS },
    )

    const prevMissing = Array.isArray(parcel.content.missing) ? parcel.content.missing : []
    applyPatch(parcel.content, patch)

    if (!REPROCESS) {
      if (missing.length) parcel.content.missing = missing
      else delete parcel.content.missing
    }

    const missingChanged = !REPROCESS && JSON.stringify(prevMissing) !== JSON.stringify(missing)
    if (patch.features || patch.tileset !== undefined || missingChanged) {
      parcel.setContent(parcel.content)
      await parcel.save()
      board.logDone(`#${id} saved  patched ${Object.keys(patch.features || {}).length}  tileset ${patch.tileset !== undefined ? 'yes' : 'no'}  missing ${REPROCESS ? '-' : missing.length}`)
    } else {
      board.logDone(`#${id} nothing to do`)
    }
  } finally {
    board.removeParcel(id)
    // arraybuffers sit outside the v8 heap; without a kick they never get collected and rss only climbs
    const gc = (globalThis as any).gc as (() => void) | undefined
    if (gc && process.memoryUsage().arrayBuffers > 256 * 1024 * 1024) gc()
  }
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
        await compileOne(id)
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

app.listen(port, () => {
  board.start()
  for (let i = 0; i < COMPILE_PARCELS; i++) void workerLoop()
  console.error(
    `[compiler] listening on ${port}  parcels=${COMPILE_PARCELS} workers=${COMPILE_WORKERS}  hoard=${!REPROCESS && hoardEnabled() ? 'on' : 'off'}  mode=${REPROCESS ? 'REPROCESS (all parcels, drafts only, no ugc put)' : 'compile'}  gc=${typeof (globalThis as any).gc === 'function' ? 'on' : 'OFF (set NODE_OPTIONS=--expose-gc)'}`,
  )
})
