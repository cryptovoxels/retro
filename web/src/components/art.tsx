import { useEffect, useState } from 'preact/hooks'
import { readNftUrl } from '../../../common/helpers/nft-url'
import { opensea } from '../../../src/utils/proxy'
import { imageUrlViaProxy } from '../../../src/utils/helpers'
import OpenseaAssetHelper from '../../../src/ui/gui/opensea-asset-helper'
import { likedArt } from '../state'

type Art = { name: string; image: string; tags: string[] }
// caip -> resolved art. hover re-renders hit this, never refetch
const cache = new Map<string, Art | null>()

// ERC1155 ids are 70+ digits; keep chips readable
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id)

async function load(src: string) {
  const nft = readNftUrl(src)
  if (!nft) return null
  const asset = await opensea(nft.contract, nft.token, nft.chain).catch(() => null)
  if (!asset?.asset_contract) return null
  const c = asset.asset_contract
  const tags = [c.schema_name, c.chain, asset.token_id ? `#${shortId(String(asset.token_id))}` : null].filter(Boolean) as string[]
  return { name: asset.name, image: imageUrlViaProxy(new OpenseaAssetHelper(asset).getImage, 256), tags }
}

// <Art mini src="eip155:1/erc721:0x.../42" />
export function Art({ src, mini }: { src: string; mini?: boolean }) {
  const [, bump] = useState(0)
  const art = cache.get(src)
  const liked = !!likedArt.value[src]

  useEffect(() => {
    if (cache.has(src)) return
    cache.set(src, null)
    load(src).then((a) => {
      cache.set(src, a)
      if (a) bump((n) => n + 1)
    })
  }, [src])

  if (!art) return null

  return (
    <div class={mini ? 'art mini' : 'art'}>
      <img src={art.image} alt={art.name} />
      <div>
        <strong>{art.name}</strong>
        <ul class="nft-tags">
          {art.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <span class="heart">{liked ? '\u2665' : '\u2661'}</span>
    </div>
  )
}
