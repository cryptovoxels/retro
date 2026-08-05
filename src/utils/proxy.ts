import { OpenSeaNftModelDetailedV2, OpenSeaNftModelDetailedV2Extended, TraitRecord } from '../../common/messages/api-opensea'
import { isAddress } from 'ethers'
import { isValidUrl } from '../../common/helpers/utils'

/** Base mainnet (OpenSea chain slug `base`). */
export const OPENSEA_BASE_CHAIN_ID = 8453

/** OpenSea `/assets/<slug>/...` path segment for permalinks and metadata. */
export function openseaAssetsChainSlug(chain_id: number): 'ethereum' | 'matic' | 'base' {
  if (chain_id === 137) return 'matic'
  if (chain_id === OPENSEA_BASE_CHAIN_ID) return 'base'
  return 'ethereum'
}

function legacyAssetSchemaName(chain_id: number, token_standard?: string | null): string {
  const ts = (token_standard || '').toLowerCase()
  if (ts.includes('1155')) return 'ERC1155'
  if (ts.includes('721')) return 'ERC721'
  if (chain_id === 137) return 'ERC1155'
  return 'ERC721'
}

// Postgres-backed OpenSea NFT (one OpenSea call on miss, forever after)
export const getNFTData = async (contract: string, token: string, chain_id = 1): Promise<OpenSeaNftModelDetailedV2Extended> => {
  const q = new URLSearchParams({ contract, token, chain_id: String(chain_id) })
  const response = await fetch(`${process.env.API || '/api'}/externals/opensea/nft.json?${q}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch NFT data: ${response.status} ${response.statusText}`)
  }
  const data = await response.json()
  if (!data?.success) {
    throw new Error('Failed to fetch NFT data')
  }
  return mapOpenseaV2ToNFTMetadata(data, chain_id)
}

export const opensea = async (contract: string, token: string, chain_id = 1): Promise<any> => {
  const nftData = await getNFTData(contract, token, chain_id)
  const total = (nftData as any).total_supply

  return {
    token_id: nftData.identifier,
    image_url: nftData.image_url,
    animation_url: nftData.animation_url,
    name: nftData.name,
    description: nftData.description,
    external_link: null,
    asset_contract: {
      address: nftData.contract,
      schema_name: legacyAssetSchemaName(chain_id, nftData.token_standard),
      chain: nftData.chain,
      name: nftData.collection,
      ...(total != null ? { total_supply: String(total) } : {}),
      ...(nftData.created_at ? { created_date: nftData.created_at } : {}),
    },
    creator: nftData.creator,
    owners: nftData.owners,
    permalink: `https://opensea.io/assets/${nftData.chain}/${nftData.contract}/${nftData.identifier}`,
  }
}

function mapOpenseaV2ToNFTMetadata(data: OpenSeaNftModelDetailedV2 & { total_supply?: number; success?: boolean; chain?: string }, chain_id: number): OpenSeaNftModelDetailedV2Extended {
  if (!data.identifier || !data.contract) {
    throw new Error(`Invalid NFT data: missing identifier or contract. Data: ${JSON.stringify(data)}`)
  }

  return {
    identifier: data.identifier,
    chain: openseaAssetsChainSlug(chain_id),
    contract: data.contract,
    animation_url: data.animation_url || null,
    image_url: data.image_url || data.display_image_url || undefined,
    traits: Array.isArray(data.traits)
      ? data.traits.map((trait: TraitRecord) => ({
          trait_type: trait.trait_type,
          value: typeof trait.value === 'string' || typeof trait.value === 'number' ? String(trait.value) : 'unknown',
          display_type: trait.display_type,
          max_value: trait.max_value,
          trait_count: trait.trait_count,
          order: trait.order,
        }))
      : [],
    creator: data.creator || '',
    description: data.description || '',
    name: data.name,
    owners: Array.isArray(data.owners)
      ? data.owners.map((owner: { address: string; quantity: number }) => ({
          address: owner.address,
          quantity: typeof owner.quantity === 'number' ? owner.quantity : 1,
        }))
      : [],
    collection: data.collection,
    token_standard: data.token_standard,
    updated_at: data.updated_at,
    is_disabled: data.is_disabled,
    is_nsfw: data.is_nsfw,
    is_suspicious: data.is_suspicious,
    metadata_url: data.metadata_url,
    created_at: data.created_at,
    display_animation_url: data.display_animation_url,
    opensea_url: data.opensea_url,
    display_image_url: data.display_image_url,
    rarity: data.rarity,
    ...(data.total_supply != null ? { total_supply: data.total_supply } : {}),
  } as OpenSeaNftModelDetailedV2Extended & { total_supply?: number }
}

// Helper function to read OpenSea URLs (ethereum, polygon/matic, base)
export const readOpenseaUrl = (url: string): { contract: string; token: string; chain: number } | null => {
  if (!isValidUrl(url)) {
    return null
  }
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

  const chainSlug = parts[1]
  const contract = parts[2]
  const token = parts[3]
  if (!isAddress(contract) || !token) {
    return null
  }

  let chain: number
  switch (chainSlug) {
    case 'ethereum':
      chain = 1
      break
    case 'matic':
    case 'polygon':
      chain = 137
      break
    case 'base':
      chain = OPENSEA_BASE_CHAIN_ID
      break
    default:
      return null
  }
  return { contract, token, chain }
}
