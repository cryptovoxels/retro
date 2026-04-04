import { Db } from '../pg'
import { Express } from 'express'
import { createHash } from 'node:crypto'

// Intentionally non cryptographic hash function
const md5 = (data: string) => createHash('md5').update(data).digest('hex').substring(0, 8)

const hash = (a: number, b: number) => {
  return parseInt(md5(`${a}@${b}`), 16) % 0xffffff
}

export default function MetricController(db: Db, app: Express) {
  const table = (i: number) => `day_${i.toString().padStart(2, '0')}`

  app.get('/api/metrics', async (req, res) => {
    const current = new Date().getUTCDay()
    const prior = (new Date().getUTCDay() + 6) % 7

    const query = `
      WITH umetrics AS (
        SELECT 
          * FROM metrics.${table(current)} WHERE created_at > now() - interval '24 hours'
        UNION 
          ALL
        SELECT 
          * FROM metrics.${table(prior)} WHERE created_at > now() - interval '24 hours'
        )
      SELECT 
        action as a,
        parcel as p,
        to_char(date_trunc('hour', created_at), 'fmHH12am') as t
      FROM 
        umetrics
      ORDER BY 
        created_at DESC
      LIMIT 
        9000
    `

    try {
      var result = await db.query('sql/get-metrics', query)
    } catch (e) {
      res.status(500).send({ ok: false })
      return
    }

    res.status(200).send({ ok: true, metrics: result.rows })
  })

  app.get('/api/parcels/:id/metrics', async (req, res) => {
    const parcelId = parseInt(req.params.id)
    const current = new Date().getUTCDay()
    const prior = (new Date().getUTCDay() + 6) % 7

    const query = `
      WITH umetrics AS (
        SELECT 
          * FROM metrics.${table(current)} WHERE created_at > now() - interval '24 hours' AND parcel = $1
        UNION 
          ALL
        SELECT 
          * FROM metrics.${table(prior)} WHERE created_at > now() - interval '24 hours' AND parcel = $1
        )
      SELECT 
        client_id as c,
        action as a,
        to_char(date_bin('5 minutes', created_at, '2026-01-01'), 'fmHH12:MIam') as t
      FROM 
        umetrics
      ORDER BY 
        created_at DESC
      LIMIT 
        100
    `

    try {
      var result = await db.query('sql/parcel-metrics', query, [parcelId])
    } catch (e) {
      res.status(500).send({ ok: false })
      return
    }

    // Hash the metrics
    const metrics = result.rows.map((row: any) => ({
      c: hash(row.c, parcelId),
      a: row.a,
      t: row.t,
    }))

    res.status(200).send({ ok: true, metrics })
  })
}
