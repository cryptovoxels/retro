import { Request, Response } from 'express'
import db, { pgp } from '../pg'

export async function searchAndReturn(req: Request, res: Response) {
  let { q } = req.query

  if (!q) {
    res.json({ success: true, results: [] })
    return
  }

  q = q.toString()
  q = q.replace(/%/g, '')
  q = q.slice(0, 80)
  q = q.toLowerCase()

  if (q == ' ' || q == '') {
    res.json({ success: true, results: [] })
    return
  }

  const like = `%${q}%`

  const limit = 50
  const page = 0

  const query = `
  SELECT 
    id, title as name, kind as type, description, created_at, ts_rank(search_tsv, plainto_tsquery('english', $1)) AS rank
  FROM   
    search_corpus
  WHERE  
    search_tsv @@ plainto_tsquery('english', $1)
  ORDER BY 
    rank DESC, created_at DESC
  LIMIT  
    $2
  OFFSET 
    $3;
  `

  //  Refresh when you need to pick up new/updated rows:
  //    REFRESH MATERIALIZED VIEW CONCURRENTLY search_corpus;

  // explicit parcel name/address match so things like "2 niven walk" always land
  const parcelQuery = `
  SELECT
    id::text AS id, COALESCE(name, address) AS name, 'parcel' AS type,
    NULL AS description, minted_at AS created_at, 1 AS rank
  FROM
    properties
  WHERE
    (minted OR is_common) AND (name ILIKE $1 OR address ILIKE $1)
  ORDER BY
    minted_at DESC
  LIMIT
    $2;
  `

  let results = []

  try {
    const [ftsResult, parcelResult] = await Promise.all([db.query<any>({ text: query, name: 'search.sql', values: [q, limit, page * limit] }), db.query<any>({ text: parcelQuery, name: 'search-parcels.sql', values: [like, limit] })])

    // parcels first, then dedupe fts rows that already matched a parcel
    const seen = new Set(parcelResult.rows.map((r: any) => `${r.type}:${r.id}`))
    results = [...parcelResult.rows, ...ftsResult.rows.filter((r: any) => !seen.has(`${r.type}:${r.id}`))]
  } catch (err: any) {
    if (err.toString().match(/not been populated/)) {
      pgp.query(`REFRESH MATERIALIZED VIEW search_corpus;`)
    }

    res.json({ success: false })
    return
  }

  res.json({ success: true, results })
}
