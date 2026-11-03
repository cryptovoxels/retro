// ABOUTME: Flips image features whose link is a marketplace nft page into nft-image.
// tsx compiler/src/nftify.ts [--dry] [--parcel <id>]

import { readNftUrl, writeCaip19 } from '../../common/helpers/nft-url'
import db from '../../server/pg'

const API = process.env.API || 'https://www.voxels.com/api'

// image features whose link parses as an nft. shared by the owner button and the one-off run
export function nftifyFeatures(content: any) {
  const nfts: { chain: number; contract: string; token: string }[] = []
  for (const f of content?.features || []) {
    if (f?.type !== 'image' || typeof f.link !== 'string') continue
    const nft = readNftUrl(f.link)
    if (!nft) continue
    f.type = 'nft-image'
    f.url = writeCaip19(nft, nft.chain === 137 ? 'erc1155' : 'erc721')
    nfts.push(nft)
  }
  return nfts
}

export async function nftifyParcel(id: number, content: any) {
  const before = JSON.stringify(content)
  const nfts = nftifyFeatures(content)
  if (!nfts.length) return { changed: false, count: 0 }
  // same compare-and-swap as compileOne: never clobber an edit made while we were running
  const saved = await db.query('embedded/nftify-save', `update properties set content = $2::text::json, updated_at = now() where id = $1 and content::jsonb = $3::jsonb`, [id, JSON.stringify(content), before])
  if (!saved.rowCount) return { changed: false, conflict: true, count: nfts.length }
  // warm the nfts table so the server paints them on first load
  for (const n of nfts) {
    const q = new URLSearchParams({ contract: n.contract, token: n.token, chain_id: String(n.chain) })
    await fetch(`${API}/externals/opensea/nft.json?${q}`).catch(() => null)
  }
  return { changed: true, count: nfts.length }
}

async function main() {
  require('./bootstrap')
  const DRY = process.argv.includes('--dry')
  const parcelArg = process.argv.indexOf('--parcel')
  const parcelId = parcelArg < 0 ? undefined : Number(process.argv[parcelArg + 1])
  const r = parcelId
    ? await db.query('embedded/nftify-one', `select id, content from properties where id = $1`, [parcelId])
    : await db.query(
        'embedded/nftify-pick',
        `select id, content from properties
         where content::text ~ '"link": ?"https?://[^"]*(opensea|rarible|superrare|foundation\\.app|artblocks|knownorigin|objkt|hicetnunc|teia\\.art|versum)'`,
      )
  let features = 0
  let parcels = 0
  for (const row of r.rows) {
    const result = DRY ? { count: nftifyFeatures(row.content).length, changed: false } : await nftifyParcel(row.id, row.content)
    if (!result.count) continue
    parcels++
    features += result.count
    if (!DRY) console.error(`#${row.id} ${result.changed ? 'saved' : 'conflict'} ${result.count}`)
  }
  console.error(`${DRY ? 'would convert' : 'converted'} ${features} features in ${parcels} parcels`)
}

if (process.argv[1]?.endsWith('nftify.ts'))
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
