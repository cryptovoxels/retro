// one-off: re-read ownerOf for every parcel from the eth contract and fix properties.owner.
// skips Parcel.save() on purpose - that writes a property_version per parcel.
//
//   DATABASE_URL=... ALCHEMY_ETH_API_KEY=... npx tsx scripts/refresh-owners.ts [--dry-run]

import db from '../server/pg'
import { getContract } from '../server/lib/utils'
import { isSecurityTeamParcel } from '../server/lib/helpers'
import { SUPPORTED_CHAINS } from '../common/helpers/chain-helpers'

const dry = process.argv.includes('--dry-run')
const CHUNK = 20

async function main() {
  const contract = await getContract('parcel', SUPPORTED_CHAINS['eth'])
  const { rows } = await db.query('embedded/all-parcel-owners', 'select id, owner, minted from properties order by id')
  let changed = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(
      rows.slice(i, i + CHUNK).map(async (p: any) => {
        if (isSecurityTeamParcel(p)) return
        let owner: string
        try {
          if (!(await contract.exists(p.id))) return
          owner = await contract.ownerOf(p.id)
        } catch (e) {
          failed++
          console.error(`parcel ${p.id} rpc failed: ${e}`)
          return
        }
        if (p.minted && p.owner?.toLowerCase() == owner.toLowerCase()) return
        changed++
        console.log(`parcel ${p.id}: ${p.owner} -> ${owner}${p.minted ? '' : ' (now minted)'}`)
        if (dry) return
        await db.query('embedded/fix-parcel-owner', 'update properties set owner = $1, minted = true, updated_at = now() where id = $2', [owner, p.id])
      }),
    )
    if (failed > 100 && !changed) throw new Error('rpc is broken (bad ALCHEMY_ETH_API_KEY?), bailing')
    if (i % 1000 == 0) console.log(`${i}/${rows.length}`)
  }

  console.log(`done: ${rows.length} parcels, ${changed} changed, ${failed} rpc failures${dry ? ' (dry run)' : ''}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
