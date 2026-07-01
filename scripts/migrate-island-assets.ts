/**
 * Migrate every parcel's UGC on an island into the single voxels-ugc bucket (ugc.crvox.com),
 * converting images to ETC1S .ktx2 + .webp, baking far-LOD placeholders, and rewriting scene JSON.
 *
 * Usage:
 *   DATABASE_URL=postgres://... UGC_ACCESS_KEY_ID=... UGC_SECRET=... [DISCORD_BOT_TOKEN=...] \
 *     tsx scripts/migrate-island-assets.ts --island="Little Ceres" [--dry-run] [--limit=N] [--parcel=123] [--concurrency=4]
 *
 * --dry-run crawls + writes a manifest but downloads/uploads nothing and never touches the DB.
 */

import PQueue from 'p-queue'
import { Pool } from 'pg'
import { configure, rewriteParcel, ParcelStats } from './lib/ugc-migrate'

const arg = (name: string) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`))
  return m ? m.split('=').slice(1).join('=') : undefined
}
const dry = process.argv.includes('--dry-run')
const island = arg('island')
const limit = arg('limit') ? parseInt(arg('limit')!, 10) : undefined
const parcel = arg('parcel') ? parseInt(arg('parcel')!, 10) : undefined
const concurrency = arg('concurrency') ? parseInt(arg('concurrency')!, 10) : 4

if (!island && !parcel) {
  console.error('need --island="Name" (or --parcel=ID)')
  process.exit(1)
}
if (!dry && (!process.env.UGC_ACCESS_KEY_ID || !process.env.UGC_SECRET)) {
  console.error('UGC_ACCESS_KEY_ID and UGC_SECRET required for live runs (use --dry-run to preview)')
  process.exit(1)
}

const slug = (island || `parcel-${parcel}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')
const manifestPath = `./migrate-${slug}-${Date.now()}.jsonl`
configure({ dryRun: dry, manifestPath })

const cs = process.env.DATABASE_URL || 'postgres://localhost/voxels'
const pool = new Pool({ connectionString: cs.replace(/^postgresql:\/\//, 'postgres://'), ssl: cs.includes('localhost') ? false : { rejectUnauthorized: false }, max: Math.max(concurrency + 2, 6) })

async function main() {
  const where = parcel ? 'id = $1' : 'island = $1'
  const params: any[] = [parcel ?? island]
  let sql = `select id, content, lightmap_url from properties where ${where} and content is not null order by id`
  if (limit) sql += ` limit ${limit}`

  const { rows } = await pool.query<{ id: number; content: any; lightmap_url: string | null }>(sql, params)
  console.log(`${dry ? '[dry-run] ' : ''}island=${island ?? '-'} parcel=${parcel ?? '-'} -> ${rows.length} parcels, concurrency=${concurrency}`)
  console.log(`manifest: ${manifestPath}`)

  const total: ParcelStats = { img: 0, vox: 0, copy: 0, skip: 0, err: 0 }
  let done = 0
  let wrote = 0
  let failed = 0

  const queue = new PQueue({ concurrency })
  for (const row of rows) {
    queue.add(async () => {
      try {
        const res = await rewriteParcel(row.id, row.content, row.lightmap_url)
        for (const k of Object.keys(total) as (keyof ParcelStats)[]) total[k] += res.stats[k]

        if (res.changed && !dry) {
          await pool.query(`update properties set content = $1, lightmap_url = $2 where id = $3`, [JSON.stringify(res.content), res.lightmap, row.id])
          wrote++
        }
        const s = res.stats
        if (s.img || s.vox || s.copy || s.err || s.skip) console.log(`parcel ${row.id}: img=${s.img} vox=${s.vox} copy=${s.copy} skip=${s.skip} err=${s.err}${res.changed ? '' : ' (no change)'}`)
      } catch (e: any) {
        failed++
        console.error(`parcel ${row.id} failed:`, e?.message || e)
      } finally {
        done++
        if (done % 50 === 0) console.log(`... ${done}/${rows.length}`)
      }
    })
  }
  await queue.onIdle()

  console.log(`\nDone. parcels=${rows.length} written=${wrote}${dry ? ' (dry run, nothing written)' : ''}`)
  console.log(`assets: images=${total.img} vox=${total.vox} copies=${total.copy} skipped=${total.skip} errors=${total.err}`)
  console.log(`manifest: ${manifestPath}`)
  if (total.err || failed) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
