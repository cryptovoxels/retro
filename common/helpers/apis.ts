import { ExponentialBackoff, handleAll, retry } from 'cockatiel'
import { parseUnits } from 'ethers'
import type { AlchemyNFTWithMetadata } from '../messages/api-alchemy'
import { OrderRecordV2 } from '../messages/api-opensea'
// Create a retry policy that'll try whatever function we execute 2 times with a randomized exponential backoff.
const retryPolicy = retry(handleAll, { maxAttempts: 2, backoff: new ExponentialBackoff() })

export const fetchJSON = (url: string, init: RequestInit): Promise<Record<string, any>> => {
  return retryPolicy.execute(async () => {
    const p = await fetch(url, init)
    if (p.ok) {
      return p.json()
    } else {
      throw new Error(`${p.status} ${p.statusText}`)
    }
  })
}

export type tokenBasicInfo = {
  address: string
  chain: number // 1 for eth, 137 for matic
  erc20?: boolean
  tokenId?: string
}

export const fetchMetadataViaAlchemy = async (token: tokenBasicInfo): Promise<(AlchemyNFTWithMetadata & { success: boolean }) | undefined> => {
  if (!token.tokenId) {
    throw Error('Fetching metadata requires an ID')
  }
  let p
  try {
    p = await fetch(`${process.env.API}/externals/alchemy/metadata.json?contract=${token.address}&tokenId=${token.tokenId}&chain_id=${token.chain}`)
  } catch {}

  if (!p) {
    return
  }

  let r
  try {
    r = (await p.json()) as AlchemyNFTWithMetadata & { success: boolean }
  } catch {}

  return r
}

export type ParcelEvent = {
  parcel_id: string
  avatar: { wallet?: string | null; uuid: string }
  event_type: 'playerleave' | 'playerenter' | 'click'
  feature: { type?: string | null; id?: string | null; uuid: string } | null
  metadata: Record<string, any> | null
}

export type ParcelEventResult = ParcelEvent & { time: string }

const key = process.env.SURVEYOR_KEY
export const SURVEYOR_URL = 'https://surveyor.crvox.com'
export const recordParcelEvent = (event: ParcelEvent) => {
  if (!key) {
    return
  }

  const init = { method: 'PUT', headers: { 'cv-surveyor-auth': key, Accept: 'application/json', 'Content-Type': 'application/json', priority: 'low' }, body: JSON.stringify(event) }
  fetch(`${SURVEYOR_URL}/`, init)
    .then((res) => {
      if (!res.ok) {
        console.error(`surveyor failed record an parcel event ${res.status} - ${res.statusText}`)
      }
    })
    .catch((err) => {
      console.error('failed sending parcel event to surveyor', err)
    })
}

export const doesUserOwnNFT = async (token_id: string, address: string, chain: 'eth' | 'matic' = 'eth') => {
  if (!token_id || !address) {
    return false
  }
  let result: { success: boolean; ownsToken?: boolean }
  try {
    const p = await fetch(`/api/avatar/owns/${chain}/${address}/${token_id}`)
    result = await p.json()
  } catch (e) {
    return false
  }

  if (result.success) {
    return result.ownsToken
  } else {
    return false
  }
}

export const typeOfContract = async (address: string, chain: 'eth' | 'matic' = 'eth') => {
  if (!address) {
    return null
  }
  let result: { success: boolean; type: 'erc721' | 'erc1155' | 'erc20' | null }
  try {
    const p = await fetch(`/api/helper/typeOfContract/${chain}/${address}`)
    result = await p.json()
  } catch (e) {
    return null
  }

  return result.type
}

export const getRenterOfParcel = async (parcelId: number) => {
  if (!parcelId) {
    return null
  }
  let result: { success: boolean; renter: string }
  try {
    const p = await fetch(`/api/parcels/${parcelId}/getRenter`)
    result = await p.json()
  } catch (e) {
    return null
  }

  return result.renter
}

export const getPropertyIdIfParcelRentable = async (parcelId: number) => {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-key': process.env.LANDWORKS_API_KEY || '',
  }
  // the URL of the landworks subgraph
  const landworksGraphQL = `https://api.thegraph.com/subgraphs/name/enterdao/landworks`
  // body is the query and the url
  const body = {
    url: landworksGraphQL,
    query: `{
  assets(where:{metaverseRegistry:"0x79986af15539de2db9a5086382daeda917a9cf0c", metaverseAssetId:"${parcelId}", status:LISTED}) {
    id
    lastRentEnd
  }
}`,
  }
  // Fetch the subgraph for list of parcels
  const p = await fetch(`${process.env.SUBGRAPHS_ROUTER}/api/graphs/query`, { method: 'POST', headers, body: JSON.stringify(body) })
  const r = (await p.json()) as { success: boolean; data: { assets: { id: string; operator: string; lastRentEnd: string }[] } }

  if (!r.success || !r.data?.assets?.length) {
    return null
  }

  const { id, lastRentEnd } = r.data.assets[0]
  const isRented = !!id && parseInt(lastRentEnd) * 1000 > Date.now()
  // returns the id of the parcel on the landworks website if exists.
  return { id, isRented }
}

/**
 * Grab the name or ENS name of that wallet
 */
export const getAvatarNameFromWallet = async (wallet: string, cachebust = false) => {
  if (wallet === '0x000000000000000000000000000000000000dead') {
    return 'ethereum burn address'
  }

  const url = `/api/avatar/${wallet}/name.json` + (cachebust ? `?cb=${Date.now()}` : '')

  try {
    const r = await fetchJSON(url, { method: 'GET', headers: { Accept: 'application/json' } })
    return r.name.name // lol
  } catch {
    return null
  }
}

/// OPENSEA WRAPPERS --------------------------------------------------------------------------------
// OPENSEA WRAPPER CAUSE HOLY SHIT
type openseaOrdersFetchConfigs = {
  asset_contract_address?: string
  token_id?: string
  token_ids?: string[]
  maker?: string
  taker?: string
  owner?: string
  is_english?: boolean
  bundled?: boolean
  include_bundled?: boolean
  listed_after?: number
  listed_before?: number
  side: 1 | 0 //1= sell;0=buy
  sale_kind?: 0 | 1 // 0 = fixed-price; 1 = Dutch
  only_english?: boolean
  limit: number
  offset: number
  order_by: 'created_date' | 'eth_price'
  order_direction: 'asc' | 'desc'
}

export const defaultOpenseaConfig: openseaOrdersFetchConfigs = {
  is_english: false,
  bundled: false,
  include_bundled: false,
  side: 1,
  limit: 30,
  offset: 0,
  order_by: 'created_date',
  order_direction: 'desc',
}

export type OpenseaListingsV2Configs = {
  asset_contract_address: string
  limit?: string
  token_ids: string[]
}

export const fetchListingsV2 = async (config: OpenseaListingsV2Configs, signal?: AbortSignal) => {
  const c = Object.assign({}, config)

  try {
    const data = await fetchJSON(`${process.env.API}/externals/opensea/listings`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(c), signal })
    return data.orders as OrderRecordV2[]
  } catch (err) {
    console.error(`fetchListingsV2 error: ${err}`)
    return []
  }
}

type gasData = {
  maxPriorityFee: number
  maxFee: number
}
type GasResponse = {
  safeLow: gasData
  standard: gasData
  fast: gasData
  estimatedBaseFee: number
  blockTime: number
}

export interface gasFeeDataResponse {
  maxFeePerGas: any
  maxPriorityFeePerGas: any
}
