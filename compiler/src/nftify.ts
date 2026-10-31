// ABOUTME: One-off. Flips image features whose link is a marketplace nft page into nft-image.
// tsx compiler/src/nftify.ts [--dry] [--parcel <id>]

import './bootstrap'
import { readNftUrl, writeCaip19 } from '../../common/helpers/nft-url'
import db from '../../server/pg'

const DRY = process.argv.includes('--dry')
const parcelArg = process.argv.indexOf('--parcel')
const parcelId = parcelArg < 0 ? undefined : Number(process.argv[parcelArg + 1])
const API = process.env.API || 'https://www.voxels.com/api'

async function main() {
  const r = parcelId
    ? await db.query('embedded/nftify-one', `select id, content from properties where id = $1`, [parcelId])
    : await db.query(
        'embedded/nftify-pick',
        `select id, content from properties
         where content::text ~ '"link": ?"https?://[^"]*(opensea|rarible|superrare|foundation\\.app|artblocks|knownorigin|objkt|hicetnunc|teia\\.art|versum)'`,
      )
  const hosts: Record<string, number> = {}
  const warm: { chain: number; contract: string; token: string }[] = []
  let parcels = 0
  for (const row of r.rows) {
    const content = row.content
    const before = JSON.stringify(content)
    let touched = false
    for (const f of content?.features || []) {
      if (f?.type !== 'image' || typeof f.link !== 'string') continue
      const nft = readNftUrl(f.link)
      if (!nft) continue
      const host = new URL(f.link).hostname.replace(/^(www|app)\./, '')
      hosts[host] = (hosts[host] || 0) + 1
      f.type = 'nft-image'
      f.url = writeCaip19(nft, nft.chain === 137 ? 'erc1155' : 'erc721')
      warm.push(nft)
      touched = true
    }
    if (!touched) continue
    parcels++
    if (DRY) continue
    // same compare-and-swap as compileOne: never clobber an edit made while we were running
    const saved = await db.query('embedded/nftify-save', `update properties set content = $2::text::json, updated_at = now() where id = $1 and content::jsonb = $3::jsonb`, [row.id, JSON.stringify(content), before])
    console.error(`#${row.id} ${saved.rowCount ? 'saved' : 'conflict'}`)
  }
  console.error(`${DRY ? 'would convert' : 'converted'} ${warm.length} features in ${parcels} parcels`)
  for (const [h, n] of Object.entries(hosts).sort((a, b) => b[1] - a[1])) console.error(`  ${h} ${n}`)
  if (DRY) return
  // warm the nfts table so the server paints them on first load
  for (const n of warm) {
    const q = new URLSearchParams({ contract: n.contract, token: n.token, chain_id: String(n.chain) })
    await fetch(`${API}/externals/opensea/nft.json?${q}`).catch(() => null)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
