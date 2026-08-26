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

  q = `%${q}%`

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

  let results = []

  try {
    const queryConfig: any = {
      text: query,
      name: 'search.sql',
      values: [q, limit, page * limit],
    }

    const queryResult = await db.query<any>(queryConfig)
    results = queryResult.rows
  } catch (err: any) {

    if (err.toString().match(/not been populated/)) {
      pgp.query(`REFRESH MATERIALIZED VIEW search_corpus;`)
    }

    res.json({ success: false })
    return
  }

  res.json({ success: true, results })
}
