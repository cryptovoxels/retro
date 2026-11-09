import { Request, Response } from 'express'
import { SUPPORTED_CHAINS_BY_ID } from '../../common/helpers/chain-helpers'
import db from '../pg'

export default async function (req: Request, res: Response) {
  // the pages that explain the world, so crawlers find more than 100k parcel ids
  const urls: any = ['', 'api', 'llms.txt', 'API.md', 'openapi.yaml', 'behaviours', 'art', 'events', 'islands', 'collections', 'womps', 'parcels'].map((p) => `https://www.voxels.com/${p}`)
  // Parcels
  let result = await db.query('embedded/get-parcel-ids', 'select id from properties where minted=true')

  result.rows.forEach((r: any) => {
    urls.push(`https://www.voxels.com/parcels/${r.id}`)
  })

  // Womps
  result = await db.query('embedded/get-womps-ids', 'select id from womps')

  result.rows.forEach((r: any) => {
    urls.push(`https://www.voxels.com/womps/${r.id}`)
  })

  // Collections
  result = await db.query('embedded/get-collections-ids', 'select chainid,address from collections')

  result.rows.forEach((r: any) => {
    urls.push(`https://www.voxels.com/collections/${SUPPORTED_CHAINS_BY_ID[r.chainid]}/${r.address}`)
  })

  // Wearables
  result = await db.query('embedded/get-wearable-ids', 'select token_id,collection_id,c.chainid as chain_id, c.address from wearables INNER JOIN collections c on c.id = wearables.collection_id where token_id is not null')

  result.rows.forEach((r: any) => {
    urls.push(`https://www.voxels.com/collections/${SUPPORTED_CHAINS_BY_ID[r.chain_id]}/${r.address}/${r.token_id}`)
  })

  // Parcel event pages
  result = await db.query('embedded/get-event-ids', 'select id from parcel_events where expires_at>= NOW()')

  result.rows.forEach((r: any) => {
    urls.push(`https://www.voxels.com/events/${r.id}`)
  })

  res.setHeader('content-type', 'text/plain')
  res.send(urls.join('\n'))
}
