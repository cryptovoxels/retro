import { isAddress } from 'ethers'

export const OPENSEA_BASE_CHAIN_ID = 8453
// tezos has no eip155 id. made-up sentinel so the nfts pk (chain_id int) stays as is
export const TEZOS_CHAIN_ID = 1729

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
  { id: TEZOS_CHAIN_ID, opensea: 'ethereum', aliases: ['tezos'] },
]

const KT1 = /^KT1[1-9A-HJ-NP-Za-km-z]{33}$/
export function isTezosAddress(s: string) {
  return KT1.test(s)
}

const KO_V3 = '0xabb3738f04dc2ec20f4ae4462c3d069d02ae045b'
const SUPERRARE_V1 = '0x41a322b28d0ff354040e2cbc676f0320d8c8850d'
const SUPERRARE_V2 = '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0'
const FOUNDATION = '0x3b3ee1931dc30c1957379fac9aba94d1c48a5405'
const ARTBLOCKS_V0 = '0x059edd72cd353df5106d2b9cc5ab83a52287ac3a'
const ARTBLOCKS_V1 = '0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270'
const HICETNUNC = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton'
const VERSUM = 'KT1LjmAdYQCLBjwv4S2oFkEzyHVkomAf5MrW'

const BY_ID = new Map(NFT_CHAINS.map((c) => [c.id, c]))
const BY_ALIAS = new Map(NFT_CHAINS.flatMap((c) => c.aliases.map((a) => [a, c])))

/** OpenSea `/assets/<slug>/...` path segment for permalinks and metadata. */
export function openseaAssetsChainSlug(chain_id: number): OpenseaChainSlug {
  return BY_ID.get(chain_id)?.opensea ?? 'ethereum'
}

function readCaip19(s: string): NftUrl | null {
  const tz = s.trim().match(/^tezos:NetXdQprcVkpaWU\/fa2:(KT1[1-9A-HJ-NP-Za-km-z]{33})\/(\d+)$/)
  if (tz) return { contract: tz[1], token: tz[2], chain: TEZOS_CHAIN_ID }
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

// marketplace pages that carry contract + token in the path (or on a known shared contract)
function readMarketUrl(url: string): NftUrl | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|app)\./, '')
  const p = u.pathname.split('/').filter(Boolean)
  const id = (s?: string) => (s && /^\d+$/.test(s) ? s : null)
  const slugId = (s?: string) => id(s?.match(/(\d+)$/)?.[1])
  const eth = (contract: string, token: string | null, chain = 1) => (token && isAddress(contract) ? { contract, token, chain } : null)
  const tz = (contract: string, token: string | null) => (token && KT1.test(contract) ? { contract, token, chain: TEZOS_CHAIN_ID } : null)
  switch (host) {
    case 'rarible.com': {
      // /token/0xc:id or /token/polygon/0xc:id
      if (p[0] !== 'token') return null
      const chain = p.length > 2 ? BY_ALIAS.get(p[1])?.id : 1
      const [contract, token] = (p[p.length - 1] || '').split(':')
      return chain ? eth(contract, id(token), chain) : null
    }
    case 'superrare.com':
    case 'superrare.co':
      if (p[0] === 'artwork-v2') return eth(SUPERRARE_V2, slugId(p[1]))
      if (p[0] === 'artwork') return eth(SUPERRARE_V1, slugId(p[1]))
      return eth(p[0] || '', id(p[1]))
    case 'foundation.app':
      return p[1] === 'foundation' ? eth(FOUNDATION, id(p[2])) : null
    case 'artblocks.io': {
      if (p[0] !== 'token') return null
      if (p.length > 2) return eth(p[1], id(p[2]))
      const token = id(p[1])
      return token ? eth(Number(token) < 3000000 ? ARTBLOCKS_V0 : ARTBLOCKS_V1, token) : null
    }
    case 'knownorigin.io': {
      // gallery edition numbers are the v3 token id of the first copy
      const edition = p[0] === 'gallery' ? p[1]?.match(/^(\d+)-/)?.[1] : null
      return edition ? eth(KO_V3, edition) : null
    }
    case 'objkt.com':
      return p[0] === 'asset' || p[0] === 'tokens' ? tz(p[1] || '', id(p[2])) : null
    case 'hicetnunc.xyz':
    case 'teia.art':
      return p[0] === 'objkt' ? tz(HICETNUNC, id(p[1])) : null
    case 'versum.xyz':
      return p[0] === 'token' ? tz(VERSUM, id(p[1])) : null
  }
  return null
}

export function readNftUrl(url: string): NftUrl | null {
  if (!url) return null
  return readCaip19(url) || readOpenseaNftUrl(url) || readMarketUrl(url)
}

/** CAIP-19 asset id, e.g. `eip155:1/erc721:0xabc.../42` or `tezos:NetXdQprcVkpaWU/fa2:KT1.../42` */
export function writeCaip19(nft: NftUrl, schema: 'erc721' | 'erc1155' = 'erc721'): string {
  if (nft.chain === TEZOS_CHAIN_ID) return `tezos:NetXdQprcVkpaWU/fa2:${nft.contract}/${nft.token}`
  return `eip155:${nft.chain}/${schema}:${nft.contract}/${nft.token}`
}
