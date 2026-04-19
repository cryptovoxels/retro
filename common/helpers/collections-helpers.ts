import * as querystring from 'querystring'
import config from '../config'
import { CollectibleBatchRecord, CollectibleInfoRecord } from '../messages/collectibles'
import { ChainIdentifier, getChainIdByName, SUPPORTED_CHAINS_BY_ID } from './chain-helpers'

export type CollectiblesData = CollectibleBatchRecord & {
  gif: string
  quantity: number
  default_bone?: string
  is_free?: boolean
}

function wearableMergeKey(w: Pick<CollectiblesData, 'token_id' | 'collection_id' | 'chain_id'>) {
  return `${w.chain_id}:${w.collection_id}:${w.token_id}`
}

export function mergeOwnedAndFreeWearables(owned: CollectiblesData[], free: CollectiblesData[]): CollectiblesData[] {
  const m = new Map<string, CollectiblesData>()
  for (const f of free) {
    m.set(wearableMergeKey(f), { ...f })
  }
  for (const o of owned) {
    const k = wearableMergeKey(o)
    const base = m.get(k)
    if (base) {
      m.set(k, {
        ...base,
        ...o,
        quantity: o.quantity,
        default_bone: o.default_bone || base.default_bone,
        is_free: base.is_free || o.is_free,
      })
    } else {
      m.set(k, o)
    }
  }
  return [...m.values()]
}

function mapFreeWearableRow(row: Record<string, any>): CollectiblesData {
  const tid = row.token_id ?? 0
  const nm = row.name ?? ''
  return {
    id: row.id,
    token_id: typeof tid == 'number' ? tid : parseInt(tid, 10),
    name: nm,
    description: row.description ?? null,
    collection_id: row.collection_id,
    category: row.category ?? null,
    author: row.author ?? null,
    hash: row.hash ?? '',
    suppressed: !!row.suppressed,
    chain_id: parseInt(String(row.chain_id ?? '1'), 10),
    collection_address: row.collection_address ?? null,
    collection_name: row.collection_name ?? null,
    gif: config.wearablePreviewURL(String(tid), nm),
    quantity: 1,
    default_bone: typeof row.default_bone == 'string' && row.default_bone ? row.default_bone : undefined,
    is_free: true,
  }
}

export async function fetchMergedWearableCatalog(wallet: string | undefined): Promise<CollectiblesData[]> {
  const [free, owned] = await Promise.all([fetchFreeWearablesData(), wallet ? fetchUsersCollectiblesData(wallet) : Promise.resolve([] as CollectiblesData[])])
  return mergeOwnedAndFreeWearables(owned, free)
}

export async function fetchFreeWearablesData(): Promise<CollectiblesData[]> {
  const r = await fetch('/api/wearables/free.json')
  if (!r.ok) {
    return []
  }
  const data = (await r.json()) as { success?: boolean; wearables?: Record<string, any>[] }
  if (!data?.success || !data.wearables) {
    return []
  }
  return data.wearables.map(mapFreeWearableRow)
}

/*
/* Collectibles owned by that user 
/* e.g. {[token_id, chain_id, collection_address, collection_id, quantity]}
*/
export async function fetchUsersCollectiblesData(wallet: string | undefined, cacheBust = false, progressCB?: (percent: number) => void): Promise<CollectiblesData[]> {
  const userItems = await fetchUsersCollectibles(wallet)

  const results: CollectiblesData[] = []

  for (const item of userItems) {
    results.push({
      id: item.id,
      token_id: item.token_id ?? 0,
      name: item.name ?? '',
      description: item.description ?? '',
      collection_id: item.collection_id,
      category: item.category ?? null,
      author: null,
      hash: item.hash ?? '',
      suppressed: item.suppressed ?? false,
      chain_id: parseInt(item.chain_id),
      collection_address: item.collection_address,
      collection_name: null,
      gif: config.wearablePreviewURL(item.token_id?.toString() ?? '0', `Mock Item #${item.token_id}`),
      quantity: item.quantity ?? 0,
      default_bone: undefined,
      is_free: false,
    })
  }

  return results
}

// // Bulk fetch additional collectible info by collection
// const itemByCollections = Object.values(groupBy(userItems, (c) => c.collection_address))

// let current = 0

// const toFetch = itemByCollections.map((groupedItems) => {
//   const chain = SUPPORTED_CHAINS_BY_ID[`${groupedItems[0].chain_id ?? 1}`]
//   const address = groupedItems[0].collection_address
//   const groupLookup = new Map<number, (typeof groupedItems)[number]>()
//   groupedItems.forEach((c) => groupLookup.set(c.token_id, c))
//   const params = new URLSearchParams({ token_ids: `${Array.from(groupLookup.keys()).join(',')}` })
//   if (cacheBust) params.set('force_update', 'true')
//   return fetch(`/api/collections/${chain}/${address}/collectibles.json?${params}`)
//     .then(async (p) => ((await p.json()) as CollectibleBatchMessage))
//     .then((r) => {
//       current++
//       progressCB?.(current / itemByCollections.length)
//       return r.collectibles.map((c) => ({
//         ...c,
//         gif: config.wearablePreviewURL(c.id, c.name),
//         quantity: groupLookup.get(c.token_id)?.quantity ?? 0,
//       }))
//     })
// })

// return Promise.all(toFetch).then((responses) => responses.flat())

/*
/* Collectibles owned by that user
/* e.g. {[token_id, chain_id, collection_address, collection_id, quantity]}
*/
export async function fetchUsersCollectibles(wallet: string | undefined): Promise<CollectibleInfoRecord[]> {
  if (!wallet) {
    console.warn("no wallet, can't fetchUsersCollectibles")
    return []
  }

  const r = await fetch(`/api/avatars/${wallet}/assets`)
  const data = await r.json()

  if (!data) {
    console.error('failed to fetchUsersCollectibles')
    return []
  }

  return data?.assets || []
}

export enum ContractTypes {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
}

export type Collection = {
  total?: number
  authors?: number
  total_authors?: number
  total_wearables?: number
  id?: any
  name?: string
  chainid?: number
  chain_identifier?: string
  description?: string
  owner?: string
  owner_name?: string
  address?: string
  chainId?: number
  collectiblesType?: string
  image_url?: string | null
  discontinued?: boolean
  slug?: string
  suppressed?: boolean
  type?: ContractTypes
  custom_attributes_names?: any
  settings?: CollectionSettings
}

export type CollectionSettings = {
  canPublicSubmit?: boolean
  coverColor?: string
  twitterHandle?: string
  virtualStore?: string
  featured?: any
  website?: string
  contractURI?: string
}

export class CollectionHelper {
  id?: any
  name?: string
  chainid: number
  description?: string
  owner?: string
  owner_name?: string
  address?: string
  collectiblesType?: string
  image_url?: string | null
  discontinued?: boolean
  slug?: string
  suppressed?: boolean
  type?: ContractTypes
  custom_attributes_names?: any
  settings?: {
    canPublicSubmit?: boolean
    coverColor?: string
    twitterHandle?: string
    virtualStore?: string
    featured?: any
    website?: string
    contractURI?: string
  }
  constructor(record: Collection) {
    if (record.chain_identifier) {
      this.chainid = getChainIdByName(record.chain_identifier as ChainIdentifier)
    } else {
      this.chainid = record.chainid || 1
    }
    Object.assign(this, record)
  }

  get permaURL() {
    return `${process.env.ASSET_PATH}/collections/${this.chainIdentifier}/${this.address || ''}`
  }

  get chainIdentifier() {
    return SUPPORTED_CHAINS_BY_ID[this.chainid]
  }
  /**
   * Returns basic information about this collection
   */
  async getData(cachebust = false) {
    const url = `/api/collections/${this.id}`

    // if (cachebust) {
    //   url += `?cb=${Date.now()}`
    // }

    try {
      const p = await fetch(url)
      const r = await p.json()
      if (r.collection) {
        Object.assign(this, r.collection)
      }

      return r.collection
    } catch (err) {
      console.error(`getData error: ${err}`)
      return null
    }
  }

  async fetchCollectibles(page?: number, query?: string, sort?: string, asc?: boolean) {
    const u = `/api/collections/${this.id}/collectibles`
    const url = new URL(u, location.toString())
    const searchParams = {
      page,
      q: query,
      sort,
      asc,
    }
    url.search = querystring.stringify(searchParams)

    try {
      const p = await fetch(url.toString())
      const r = await p.json()

      return r.collectibles
    } catch (err) {
      console.error(`fetchCollectibles error: ${err}`)
      return []
    }
  }
}
