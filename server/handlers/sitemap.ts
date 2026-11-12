import { Request, Response } from 'express'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import db from '../pg'

const site = 'https://www.voxels.com'
const size = 40000
const pages = ['', 'api', 'llms.txt', 'API.md', 'openapi.yaml', 'behaviours', 'art', 'events', 'islands', 'collections', 'womps', 'parcels']
const collectionPath = (r: any) => `collections/${SUPPORTED_CHAINS_BY_ID[r.chainid]}/${encodeURIComponent(r.address)}`

const feeds: Record<string, { from: string; fields: string; order: string; path: (r: any) => string }> = {
  parcels: { from: 'properties where minted=true', fields: 'id', order: 'id', path: (r) => `parcels/${r.id}` },
  womps: { from: "womps where kind in ('public', 'broadcast')", fields: 'id', order: 'id', path: (r) => `womps/${r.id}` },
  collections: { from: 'collections where address is not null and chainid in (0,1,137)', fields: 'chainid,address', order: 'id', path: collectionPath },
  wearables: {
    from: 'wearables w join collections c on c.id=w.collection_id where w.token_id is not null and c.address is not null and c.chainid in (0,1,137)',
    fields: 'c.chainid,c.address,w.token_id',
    order: 'w.id',
    path: (r) => `${collectionPath(r)}/${r.token_id}`,
  },
  events: { from: 'parcel_events where expires_at>=now()', fields: 'id', order: 'id', path: (r) => `events/${r.id}` },
}

export default async function sitemap(req: Request, res: Response) {
  const { kind, page } = req.params
  if (!kind) {
    const maps = ['pages-1']
    for (const [name, feed] of Object.entries(feeds)) {
      const { rows } = await db.query(`sitemap-count-${name}`, `select count(*) from ${feed.from}`)
      for (let i = 1; i <= Math.ceil(Number(rows[0].count) / size); i++) maps.push(`${name}-${i}`)
    }
    return res.type('application/xml').send(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${maps.map((map) => `<sitemap><loc>${site}/sitemap-${map}.txt</loc></sitemap>`).join('')}</sitemapindex>`)
  }
  if (kind === 'pages' && page === '1') return res.type('text/plain').send(pages.map((p) => `${site}/${p}`).join('\n'))
  const offset = (Number(page) - 1) * size
  if (!Object.prototype.hasOwnProperty.call(feeds, kind) || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(offset)) return res.sendStatus(404)
  const feed = feeds[kind]
  const { rows } = await db.query(`sitemap-page-${kind}`, `select ${feed.fields} from ${feed.from} order by ${feed.order} limit ${size} offset $1`, [offset])
  if (!rows.length) return res.sendStatus(404)
  res.type('text/plain').send(rows.map((r) => `${site}/${feed.path(r)}`).join('\n'))
}
