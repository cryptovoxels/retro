// ABOUTME: Flips image features whose link is a marketplace nft page into nft-image.
// tsx compiler/src/nftify.ts [--dry] [--parcel <id>]

import { readNftUrl, writeCaip19 } from '../../common/helpers/nft-url'

// image features whose link parses as an nft. shared by the owner button and the one-off run
export function nftifyFeatures(content: any) {
  let count = 0
  for (const f of content?.features || []) {
    if (f?.type !== 'image' || typeof f.link !== 'string') continue
    const nft = readNftUrl(f.link)
    if (!nft) continue
    f.type = 'nft-image'
    delete f.draft
    f.url = writeCaip19(nft, nft.chain === 137 ? 'erc1155' : 'erc721')
    count++
  }
  return count
}

export async function nftifyParcel(id: number, content: any, owner: string) {
  const before = JSON.stringify(content)
  const count = nftifyFeatures(content)
  if (!count) return { changed: false, count: 0 }
  // same compare-and-swap as compileOne: never clobber an edit made while we were running
  const { default: db } = await import('../../server/pg')
  const saved = await db.query(
    'embedded/nftify-save',
    `update properties set content = $2::text::json, updated_at = now(), memoized_hash = encode(digest($2::text, 'sha1'), 'hex') where id = $1 and content::jsonb = $3::jsonb and lower(owner) = lower($4)`,
    [id, JSON.stringify(content), before, owner],
  )
  if (!saved.rowCount) return { changed: false, conflict: true, count }
  return { changed: true, count }
}

async function main() {
  require('./bootstrap')
  const { default: db } = await import('../../server/pg')
  const DRY = process.argv.includes('--dry')
  const parcelArg = process.argv.indexOf('--parcel')
  const parcelId = parcelArg < 0 ? undefined : Number(process.argv[parcelArg + 1])
  if (parcelArg >= 0 && (!Number.isInteger(parcelId) || !parcelId || parcelId < 1)) throw new Error('Invalid --parcel id')
  const r = parcelId
    ? await db.query('embedded/nftify-one', `select id, owner, content from properties where id = $1`, [parcelId])
    : await db.query(
        'embedded/nftify-pick',
        `select id, owner, content from properties
         where content::text ~ '"link": ?"https?://[^"]*(opensea|rarible|superrare|foundation\\.app|artblocks|knownorigin|objkt|hicetnunc|teia\\.art|versum)'`,
      )
  let features = 0
  let parcels = 0
  for (const row of r.rows) {
    const result = DRY ? { count: nftifyFeatures(row.content), changed: false } : await nftifyParcel(row.id, row.content, row.owner)
    if (!DRY && !result.changed && result.count) {
      console.error(`#${row.id} conflict`)
      continue
    }
    if (!result.count) continue
    parcels++
    features += result.count
    if (!DRY) console.error(`#${row.id} saved ${result.count}`)
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
