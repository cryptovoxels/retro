import { request } from 'node:https'
import { rootCertificates } from 'node:tls'
import { resolve } from 'node:path'
import type { Express } from 'express'
import type { PassportStatic } from 'passport'
import { requireAdmin } from '../server/lib/helpers'

const windows = { '15m': [900, 5], '1h': [3600, 30], '24h': [86400, 900], '30d': [2592000, 86400] } as const
const services = ['web', 'mp', 'renderer', 'compressor', 'compiler', 'function']
const failed = { bool: { should: [{ range: { status: { gte: 400 } } }, { term: { aborted: true } }], minimum_should_match: 1 } }

function search(body: object): Promise<any> {
  return new Promise((done, fail) => {
    const req = request(
      new URL('/voxels-requests/_search', process.env.REQUEST_SEARCH_URL),
      {
        method: 'POST',
        auth: process.env.REQUEST_READ_AUTH,
        ca: rootCertificates.concat(process.env.REQUEST_SEARCH_CA || []),
        rejectUnauthorized: true,
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(7000),
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('error', fail)
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('search ' + res.statusCode)
            const result = JSON.parse(data)
            if (result.timed_out || result._shards?.failed) throw new Error('incomplete search')
            done(result)
          } catch (e) {
            fail(e)
          }
        })
      },
    )
    req.on('error', fail)
    req.end(JSON.stringify(body))
  })
}

const baselineDay = process.env.REQUEST_BASELINE_DAY
let baseline: number | null = null
async function dailyBaseline() {
  if (baseline !== null || !baselineDay) return baseline
  const start = Date.parse(baselineDay + 'T00:00:00Z')
  const end = start + 86400000
  if (!Number.isFinite(start) || Date.now() < end || Date.now() > start + 30 * 86400000) return null
  const result = await search({ size: 0, query: { range: { at: { gte: start, lt: end } } }, aggs: { errors: { filter: failed } } })
  if (result.hits.total.value) baseline = result.aggregations.errors.doc_count
  return baseline
}

async function readings(span: keyof typeof windows, service: string) {
  const [seconds, step] = windows[span]
  const end = Date.now(),
    start = end - seconds * 1000
  const filter: object[] = [{ range: { at: { gte: start, lte: end } } }]
  if (service) filter.push({ term: { service } })
  const [result, base] = await Promise.all([
    search({
      size: 36,
      track_total_hits: true,
      sort: [{ at: 'desc' }],
      query: { bool: { filter } },
      aggs: {
        errors: { filter: failed, aggs: { routes: { terms: { field: 'route', size: 8 } } } },
        latency: { percentiles: { field: 'ms', percents: [95] } },
        lag: { percentiles: { field: 'lag_ms', percents: [95] } },
        series: {
          date_histogram: { field: 'at', fixed_interval: step + 's', min_doc_count: 0, extended_bounds: { min: start, max: end } },
          aggs: {
            failures: { filter: failed },
            latency: { avg: { field: 'ms' } },
          },
        },
        services: { terms: { field: 'service', size: 10 }, aggs: { errors: { filter: failed } } },
      },
    }),
    dailyBaseline(),
  ])
  const a = result.aggregations
  return {
    at: end,
    step,
    total: result.hits.total.value,
    errors: a.errors.doc_count,
    latency: a.latency.values['95.0'],
    lag: a.lag.values['95.0'],
    baseline: base,
    baselineDay,
    series: a.series.buckets.map((b: any) => [b.key, b.doc_count, b.failures.doc_count, b.latency.value]),
    services: a.services.buckets.map((b: any) => [b.key, b.doc_count, b.errors.doc_count]),
    routes: a.errors.routes.buckets.map((b: any) => [b.key, b.doc_count]),
    events: result.hits.hits.map((h: any) => h._source),
  }
}

export function statsRoutes(app: Express, passport: PassportStatic) {
  app.use((req, res, next) => {
    if (req.hostname !== 'stats.voxels.com') return next()
    if (req.path === '/' && ['GET', 'HEAD'].includes(req.method)) return res.set('Cache-Control', 'no-store').sendFile(resolve('stats/index.html'))
    return res.sendStatus(404)
  })
  const cache = new Map<string, { until: number; value: Promise<any> }>()
  app.get(
    '/api/admin/network',
    (req, res, next) => {
      res.set({ 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': 'https://stats.voxels.com', 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' })
      next()
    },
    passport.authenticate('jwt', { session: false }),
    requireAdmin,
    async (req, res) => {
      const requested = String(req.query.span || '')
      const span = Object.prototype.hasOwnProperty.call(windows, requested) ? (requested as keyof typeof windows) : '15m'
      const service = services.includes(String(req.query.service)) ? String(req.query.service) : ''
      const key = span + service
      try {
        let item = cache.get(key)
        if (!item || item.until <= Date.now()) {
          item = { until: Date.now() + (span === '30d' ? 60000 : 5000), value: readings(span, service) }
          cache.set(key, item)
        }
        res.json(await item.value)
      } catch {
        res.status(503).json({ error: 'request index unavailable' })
      }
    },
  )
}
