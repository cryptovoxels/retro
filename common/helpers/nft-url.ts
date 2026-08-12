import { isAddress } from 'ethers'

export const OPENSEA_BASE_CHAIN_ID = 8453

export type OpenseaChainSlug = 'ethereum' | 'matic' | 'base'

export type NftUrl = { contract: string; token: string; chain: number }

type NftChain = {
  id: number
  opensea: OpenseaChainSlug
  aliases: string[]
}

const NFT_CHAINS: NftChain[] = [
  { id: 1, opensea: 'ethereum', aliases: ['ethereum', 'eth'] },
  { id: 137, opensea: 'matic', aliases: ['matic', 'polygon'] },
  { id: OPENSEA_BASE_CHAIN_ID, opensea: 'base', aliases: ['base'] },
]

const BY_ID = new Map(NFT_CHAINS.map((c) => [c.id, c]))
const BY_ALIAS = new Map(NFT_CHAINS.flatMap((c) => c.aliases.map((a) => [a, c])))

/** OpenSea `/assets/<slug>/...` path segment for permalinks and metadata. */
export function openseaAssetsChainSlug(chain_id: number): OpenseaChainSlug {
  return BY_ID.get(chain_id)?.opensea ?? 'ethereum'
}

function readCaip19(s: string): NftUrl | null {
  const m = s.trim().match(/^eip155:(\d+)\/(erc721|erc1155):(0x[a-fA-F0-9]{40})\/(.+)$/i)
  if (!m) return null
  const chain = parseInt(m[1], 10)
  if (!BY_ID.has(chain)) return null
  const contract = m[3]
  const token = m[4]
  if (!isAddress(contract) || !token) return null
  return { contract, token, chain }
}

function readOpenseaNftUrl(url: string): NftUrl | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const parts = pathname.split('/').filter(Boolean)
  // /item/<chain>/<contract>/<token> (current), /assets/<chain>/<contract>/<token>,
  // or /assets/<contract>/<token> (legacy ethereum)
  if ((parts[0] !== 'assets' && parts[0] !== 'item') || parts.length < 3) {
    return null
  }

  if (parts.length === 3) {
    const contract = parts[1]
    const token = parts[2]
    if (!isAddress(contract) || !token) {
      return null
    }
    return { contract, token, chain: 1 }
  }

  const chain = BY_ALIAS.get(parts[1])
  const contract = parts[2]
  const token = parts[3]
  if (!chain || !isAddress(contract) || !token) {
    return null
  }
  return { contract, token, chain: chain.id }
}

export function readNftUrl(url: string): NftUrl | null {
  if (!url) return null
  return readCaip19(url) || readOpenseaNftUrl(url)
}
