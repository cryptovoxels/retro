import db from './pg'
import truncateMetrics from './jobs/truncate-metrics'
import { named } from './lib/logger'

const log = named('cron')

const HOUR = 1000 * 60 * 60
const DAY = HOUR * 24

// half-assed cross-worker lock: grab a session advisory lock for the length of
// the job so only one app platform worker runs it. if the lock machinery itself
// breaks, run anyway - better to run twice than never.
async function runLocked(key: number, job: () => Promise<unknown>) {
  const run = () => Promise.resolve(job()).catch((e) => log.error(`cron ${key} failed: ${e}`))

  let client
  try {
    client = await db.connect()
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key])
    if (!rows[0]?.ok) {
      client.release()
      return // another worker is already on it
    }
  } catch (err) {
    log.error(`cron ${key} lock failed, running unlocked: ${err}`)
    if (client) client.release()
    return run()
  }

  try {
    await run()
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {})
    client.release()
  }
}

function schedule(key: number, everyMs: number, job: () => Promise<unknown>) {
  const tick = () => runLocked(key, job)
  tick()
  setInterval(tick, everyMs)
}

export default function startJobs() {
  // let boot settle before we start hitting pg
  setTimeout(() => {
    schedule(1, DAY, () => truncateMetrics())
    schedule(2, HOUR, () => db.query('embedded/refresh-search', 'REFRESH MATERIALIZED VIEW search_corpus'))
  }, 1000)
}
