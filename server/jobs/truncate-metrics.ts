import { named } from '../lib/logger'
import db from '../pg'

const log = named('jobs')

const table = (i: number) => `day_${i.toString().padStart(2, '0')}`

export default async function truncateMetrics() {
  // 7-day rotation: clear the table that is today + 6 (i.e. yesterday in mod-7)
  // so it is empty before it gets reused in 1 day.
  // target is always 0-6 (% 7 on a non-negative integer, never user input).
  const target = (new Date().getUTCDay() + 6) % 7
  if (target < 0 || target > 6) return
  const name = table(target)
  log.info(`truncating metrics table metrics.${name}`)
  await db.query('embedded/truncate-metrics', `TRUNCATE metrics.${name}`)
}
