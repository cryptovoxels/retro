import { simpleHash } from '../../common/helpers/utils'
import config from '../../common/config'
import * as querystring from 'querystring'
import { OpenSeaNftModelDetailedV2, OpenSeaNftModelDetailedV2Extended, TraitRecord } from '../../common/messages/api-opensea'
import { isAddress } from 'ethers'
import { isValidUrl } from '../../common/helpers/utils'

/** Base mainnet (OpenSea chain slug `base`). Requires `chain_id=8453` on `/v2/opensea` (proxy CDN). */
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

// Main function to get NFT data
export const getNFTData = async (contract: string, token: string, chain_id = 1, account_address = '', forceUpdate = false): Promise<OpenSeaNftModelDetailedV2Extended> => {
  const parameters: { contract: string; token: string; chain_id: number; account_address: string; force_update?: number } = {
    contract,
    token,
    chain_id,
    account_address: '',
  }

  if (account_address && isAddress(account_address)) {
    parameters.account_address = account_address
  }

  if (forceUpdate) {
    parameters.force_update = 1
  }

  const hash = urlHasher(`chain_id=${chain_id},contract=${parameters.contract},token=${parameters.token},account_address=${parameters.account_address}`)

  // Try cached version first
  if (!forceUpdate) {
    try {
      const response = await fetch(`${config.proxy_cdn_base_url}/v2/opensea/${hash}.json`)
      if (response.ok) {
        const data = await response.json()
        return mapOpenseaV2ToNFTMetadata(data, chain_id)
      }
    } catch (err) {
      // console.error(`Error loading cached OpenSea data: ${err}`);
    }
  }

  // Fallback to direct API call
  return fetch(`${config.proxy_base_url}/v2/opensea?${querystring.stringify(parameters)}`).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch NFT data: ${response.status} ${response.statusText}`)
    }
    // Parse the response as plain JSON first to avoid validation errors
    const data = await response.json()
    // Then manually validate and convert to our format
    return mapOpenseaV2ToNFTMetadata(data, chain_id)
  })
}

// Legacy function for backward compatibility
export const opensea = async (contract: string, token: string, chain_id = 1, accountAddress = '', forceUpdate = false): Promise<any> => {
  const nftData = await getNFTData(contract, token, chain_id, accountAddress, forceUpdate)

  // Convert from NFTMetadata to a format compatible with the old ProxyAssetOpensea
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
    },
    creator: nftData.creator,
    owners: nftData.owners,
    permalink: `https://opensea.io/assets/${nftData.chain}/${nftData.contract}/${nftData.identifier}`,
  }
}

// Helper function to hash URLs for caching
function urlHasher(urlOrString: string, ignoreParams?: string[]): string {
  try {
    const u = new URL(urlOrString)
    ignoreParams?.forEach((x) => u.searchParams.delete(x))
    urlOrString = u.toString()
  } catch {
    // NO-OP
  }
  return simpleHash(urlOrString)
}

function mapOpenseaV2ToNFTMetadata(data: OpenSeaNftModelDetailedV2, chain_id: number): OpenSeaNftModelDetailedV2Extended {
  // Validate critical fields
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
    // Copy remaining fields from OpenSeaNftModelDetailedV2
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
  }
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
  // /assets/<chain>/<contract>/<token> or /assets/<contract>/<token> (legacy ethereum)
  if (parts[0] !== 'assets' || parts.length < 3) {
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
