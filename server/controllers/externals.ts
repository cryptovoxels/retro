import { ethers } from 'ethers'
import { Express, Request, Response } from 'express'
import { chunk } from 'lodash'
import { PassportStatic } from 'passport'
import querystring from 'querystring'
import { fetchJSON, OpenseaListingsV2Configs } from '../../common/helpers/apis'
import { isStringHex } from '../../common/helpers/utils'
import { AlchemyNFTAPIWithMetadata, AlchemyNFTWithMetadata } from '../../common/messages/api-alchemy'
import { OpenseaListingsResponseV2, OpenSeaNftModelV2, OpenSeaNFTV2Extended, OrderRecordV2 } from '../../common/messages/api-opensea'
import cache from '../cache'
import { encryptPoapEditCode, redeemPoapForWallet } from '../handlers/poap-handler'
import { requireAdmin } from '../lib/helpers'
import log from '../lib/logger'
import { parseQueryInt } from '../lib/query-parsing-helpers'
import Parcel from '../parcel'
import { Db } from '../pg'
import { VoxelsUser } from '../user'

// External APIs
export default function ExternalsController(db: Db, passport: PassportStatic, app: Express) {
  app.get('/api/externals/opensea/nfts.json', passport.authenticate('jwt', { session: false }), async (req, res) => {
    const wallet = (req.user as VoxelsUser | null)?.wallet
    if (!wallet) {
      return res.status(401).send({ success: false })
    }
    const apiKey = process.env.OPENSEA_APIKEY
    if (!apiKey) {
      return res.status(503).send({ success: false })
    }
    const headers = { 'X-API-KEY': apiKey }
    const chain = 'ethereum' as const
    const fetchMore = async () => {
      const LIMIT = 50
      let next = ''
      const result: OpenSeaNFTV2Extended[] = []
      const f = async () => {
        const response = await fetch(`https://api.opensea.io/api/v2/chain/${chain}/account/${wallet}/nfts?limit=${LIMIT}` + (next ? `&next=${next}` : ''), { method: 'GET', headers })
        if (response.status !== 200) {
          log.info('There was a problem with opensea fetch! Status Code: ' + response.status, response.statusText)
          return
        }
        const data = await response.json()
        next = data.next
        const assets: OpenSeaNftModelV2[] = data.nfts
        if (next) {
          await f()
        }
        result.push(...assets.map((a) => ({ ...a, chain, owner: wallet, permalink: `https://opensea.io/assets/${chain}/${a.contract}/${a.identifier}` })))
      }
      await f()
      return result
    }

    const nfts = await fetchMore()
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.send({ success: true, nfts })
  })

  app.get('/api/externals/alchemy/nfts.json', cache('60 seconds'), passport.authenticate('jwt', { session: false }), async (req, res) => {
    const wallet = (req.user as VoxelsUser | null)?.wallet
    if (!wallet) {
      return res.status(401).send({ success: false })
    }

    const ALCHEMY_ETH_API_KEY = process.env.ALCHEMY_ETH_API_KEY
    const ALCHEMY_MATIC_API_KEY = process.env.ALCHEMY_MATIC_API_KEY

    const ethPage: string | undefined = req.query.ethPage !== undefined && typeof req.query.ethPage !== 'string' ? undefined : req.query.ethPage
    const maticPage: string | undefined = req.query.maticPage !== undefined && typeof req.query.maticPage !== 'string' ? undefined : req.query.maticPage

    const fetchNFTs = async (chain: 'eth' | 'polygon' = 'eth', page?: string): Promise<{ nfts: AlchemyNFTWithMetadata[]; error?: string }> => {
      const URL = `https://${chain}-mainnet.g.alchemy.com/v2/${chain == 'eth' ? ALCHEMY_ETH_API_KEY : ALCHEMY_MATIC_API_KEY}/getNFTs/`
      const fetchURL = `${URL}?owner=${wallet}&withMetadata=true${page ? `&pageKey=${page}` : ''}`

      let p, r
      try {
        p = await fetch(fetchURL)
      } catch (e) {
        return { nfts: [], error: 'Could not reach API, please try again later' }
      }
      try {
        r = (await p?.json()) as AlchemyNFTAPIWithMetadata
      } catch {
        return { nfts: [], error: 'Could not reach API, please try again later' }
      }

      if (r.pageKey) {
        if (chain == 'eth') {
          newEthPage = r.pageKey
        } else {
          newMaticPage = r.pageKey
        }
      }

      const nfts = r.ownedNfts?.map((nft) => {
        nft.contract.chain = chain
        return nft
      })
      totalCount += r.totalCount
      return { nfts: nfts || [] }
    }

    let newEthPage = null
    let newMaticPage = null
    let totalCount = 0
    const nfts = []
    let error: string | undefined = undefined
    if ((ethPage && maticPage) || (!ethPage && !maticPage)) {
      let r = await fetchNFTs('eth', ethPage)
      error = r.error
      nfts.push(...r.nfts)
      r = await fetchNFTs('polygon', maticPage)
      if (r.error) error = r.error
      nfts.push(...r.nfts)
    } else if (ethPage && !maticPage) {
      const r = await fetchNFTs('eth', ethPage)
      error = r.error
      nfts.push(...r.nfts)
    } else if (!ethPage && maticPage) {
      const r = await fetchNFTs('polygon', maticPage)
      error = r.error
      nfts.push(...r.nfts)
    }

    res.json({ success: true, totalCount, nfts: nfts.filter((nft) => !nft.error), newMaticPage, newEthPage, error })
  })

  app.get('/api/externals/alchemy/metadata.json', cache('30 seconds'), async (req, res) => {
    const ALCHEMY_ETH_API_KEY = process.env.ALCHEMY_ETH_API_KEY
    const ALCHEMY_MATIC_API_KEY = process.env.ALCHEMY_MATIC_API_KEY
    const info = await validateMetadataQueryAndReturn(req)
    if (!info) {
      res.status(403).json({ success: false })
      return
    }
    const { contractAddress, tokenId, chain, tokenType } = info

    let url = `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_ETH_API_KEY}/getNFTMetadata`
    if (chain == 137) {
      url = `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_MATIC_API_KEY}/getNFTMetadata`
    }

    const fetchURL = `${url}?contractAddress=${contractAddress}&tokenId=${tokenId}${tokenType ? `&tokenType=${tokenType.toUpperCase()}` : ''} `
    let p
    try {
      p = await fetch(fetchURL)
    } catch {}

    if (!p) {
      res.json({ success: false, error: 'Could not reach Alchemy' })
      return
    }

    let r
    try {
      r = (await p.json()) as AlchemyNFTWithMetadata
    } catch {}
    if (r?.error) {
      res.json({ success: false, error: 'Could not resolve metadata URI' })
      return
    }

    res.json({ success: true, ...r })
  })

  // Poap
  app.post('/api/poap/encrypt', passport.authenticate('jwt', { session: false }), encryptPoapEditCode)
  app.post('/api/poap/redeem', passport.authenticate('jwt', { session: false }), redeemPoapForWallet)

  // Floor + 30d volume + the suggested "just above floor" price and the fees the
  // client must bake into the Seaport consideration for OpenSea to accept the listing.
  app.get('/api/admin/opensea/stats', cache('5 minutes'), passport.authenticate('jwt', { session: false }), requireAdmin, async (_req, res) => {
    try {
      const stats = await openseaParcelStats()
      const fees = await openseaParcelFees()
      // 5% over floor. blunt and easy to tune.
      const suggested = stats.floor ? Math.round(stats.floor * 1.05 * 1e4) / 1e4 : 0
      res.json({ success: true, ...stats, suggested, fees })
    } catch (e) {
      log.error('opensea stats failed', { e: String(e) })
      res.json({ success: false })
    }
  })

  // The client signs the Seaport order; we forward it to OpenSea so the api key stays server-side.
  app.post('/api/admin/parcels/:id/list', passport.authenticate('jwt', { session: false }), requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return res.status(400).json({ success: false })
    const { parameters, signature, protocol_address } = req.body
    if (!parameters || !signature) return res.status(400).json({ success: false, message: 'missing order' })
    try {
      const r = await fetch('https://api.opensea.io/api/v2/orders/ethereum/seaport/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.OPENSEA_APIKEY! },
        body: JSON.stringify({ parameters, signature, protocol_address }),
      })
      const body: any = await r.json().catch(() => ({}))
      if (!r.ok) {
        return res.status(502).json({ success: false, message: body?.errors?.join?.(', ') || `opensea ${r.status}` })
      }
      // light up the map "on sale" badge
      try {
        const p = await Parcel.load(id)
        await p?.refreshListedAt()
      } catch {}
      res.json({ success: true, order: body.order })
    } catch (e: any) {
      res.json({ success: false, message: e?.toString() })
    }
  })

  // Homepage marketplace feed: active parcel listings bucketed into fresh / secondary / deals.
  app.get('/api/classifieds.json', cache('60 seconds'), async (_req, res) => {
    try {
      const data = await classifieds(db)
      res.json({ success: true, ...data })
    } catch (e) {
      log.error('classifieds failed', { e: String(e) })
      res.json({ success: false, floor: 0, fresh: [], secondary: [], deals: [] })
    }
  })

  app.post('/api/externals/opensea/listings', cache('30 seconds'), async (req: Request, res: Response) => {
    const config = req.body as OpenseaListingsV2Configs
    const result = await fetchOpenseaListingsV2(config)
    switch (result.type) {
      case 'success':
        res.json({ success: true, orders: result.orders })
        break
      case 'serverError':
        res.sendStatus(500)
        break
      case 'possibleClientErrorNotSureLol':
        res.sendStatus(400)
        break
      default:
        const n: never = result
        log.error('Unhandled result', { result: n })
        res.sendStatus(500)
    }
  })
}

// Resolve the parcel contract to its OpenSea collection slug (cached for the process).
let cachedSlug: string | null = null
export const openseaSlug = async (): Promise<string> => {
  if (cachedSlug) return cachedSlug
  const addr = process.env.CONTRACT_ADDRESS
  try {
    const data = await fetchJSON(`https://api.opensea.io/api/v2/chain/ethereum/contract/${addr}`, { method: 'GET', headers: { 'X-API-KEY': process.env.OPENSEA_APIKEY! } })
    cachedSlug = (data.collection as string) || 'cryptovoxels'
  } catch {
    cachedSlug = 'cryptovoxels'
  }
  return cachedSlug
}

export const openseaParcelStats = async (): Promise<{ slug: string; floor: number; volume30d: number }> => {
  const slug = await openseaSlug()
  const data = await fetchJSON(`https://api.opensea.io/api/v2/collections/${slug}/stats`, { method: 'GET', headers: { 'X-API-KEY': process.env.OPENSEA_APIKEY! } })
  const floor = Number(data?.total?.floor_price ?? 0)
  const thirty = (data?.intervals || []).find((i: any) => i.interval === 'thirty_day')
  return { slug, floor, volume30d: Number(thirty?.volume ?? 0) }
}

const TEAM_WALLET = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'.toLowerCase()

type ClassifiedItem = { id: number; name: string | null; address: string; price: number; permalink: string; seller: string }

const classifieds = async (db: Db): Promise<{ floor: number; fresh: ClassifiedItem[]; secondary: ClassifiedItem[]; deals: ClassifiedItem[] }> => {
  const slug = await openseaSlug()
  const data = await fetchJSON(`https://api.opensea.io/api/v2/listings/collection/${slug}/best?limit=100`, { method: 'GET', headers: { 'X-API-KEY': process.env.OPENSEA_APIKEY! } })

  const items: ClassifiedItem[] = []
  for (const l of data?.listings || []) {
    const params = l?.protocol_data?.parameters
    const id = Number(params?.offer?.[0]?.identifierOrCriteria)
    const cur = l?.price?.current
    if (!id || !cur) continue
    const price = Number(cur.value) / Math.pow(10, Number(cur.decimals || 18))
    items.push({ id, name: null, address: '', price, permalink: `https://opensea.io/assets/ethereum/${process.env.CONTRACT_ADDRESS}/${id}`, seller: String(params.offerer || '').toLowerCase() })
  }

  if (!items.length) return { floor: 0, fresh: [], secondary: [], deals: [] }

  // pull names/addresses for the listed ids
  const r = await db.query('sql/classifieds-names', `select id, name, address from properties where id = any($1::int[])`, [items.map((i) => i.id)])
  const byId: Record<number, { name: string | null; address: string }> = {}
  for (const row of r.rows) byId[row.id] = { name: row.name, address: row.address }
  for (const i of items) {
    const m = byId[i.id]
    if (m) {
      i.name = m.name
      i.address = m.address
    }
  }

  const floor = Math.min(...items.map((i) => i.price))
  const fresh = items.filter((i) => i.seller === TEAM_WALLET)
  const secondary = items.filter((i) => i.seller !== TEAM_WALLET)
  const deals = items.filter((i) => i.price <= floor * 1.1).sort((a, b) => a.price - b.price)
  return { floor, fresh, secondary, deals }
}

// OpenSea + creator fees, as basis points, that must be in the listing consideration.
export const openseaParcelFees = async (): Promise<{ recipient: string; bps: number }[]> => {
  const slug = await openseaSlug()
  try {
    const data = await fetchJSON(`https://api.opensea.io/api/v2/collections/${slug}`, { method: 'GET', headers: { 'X-API-KEY': process.env.OPENSEA_APIKEY! } })
    return (data?.fees || []).map((f: any) => ({ recipient: f.recipient, bps: Math.round(Number(f.fee) * 100) })).filter((f: any) => f.recipient && f.bps > 0)
  } catch {
    return []
  }
}

const validateMetadataQueryAndReturn = async (req: Request) => {
  const contractAddress = req.query.contract
  if (typeof contractAddress !== 'string' || !ethers.isAddress(contractAddress)) {
    return null
  }

  // handles both decimal and hex
  const tokenId = typeof req.query.tokenId === 'string' && isStringHex(req.query.tokenId) ? parseInt(req.query.tokenId, 16) : parseQueryInt(req.query.tokenId)
  if (!tokenId || isNaN(tokenId)) {
    return null
  }

  const chain = 'chain_id' in req.query && typeof req.query.chain_id === 'string' ? (isNaN(parseInt(req.query.chain_id)) ? 1 : parseInt(req.query.chain_id)) : 1
  const tokenType = undefined //req.query.type

  // if (!tokenType || !['erc20', 'erc721', 'erc20'].includes(tokenType)) {
  //   tokenType = await getTypeOfContract(contractAddress, chain)
  // } else {
  //   tokenType = null
  // }

  return { contractAddress, tokenId: String(tokenId), chain, tokenType } as { contractAddress: string; tokenId: string; chain: number; tokenType?: string }
}

type FetchOpenseaListingsResult =
  | {
      type: 'serverError'
    }
  | {
      type: 'possibleClientErrorNotSureLol'
    }
  | {
      type: 'success'
      orders: OrderRecordV2[]
    }

const fetchOpenseaListingsV2 = async (config: OpenseaListingsV2Configs): Promise<FetchOpenseaListingsResult> => {
  if (!config.token_ids?.length) {
    return {
      type: 'success',
      orders: [],
    }
  }

  const c = Object.assign({}, config)

  if (!process.env.OPENSEA_APIKEY) {
    return {
      type: 'serverError',
    }
  }

  const headers = { 'X-API-KEY': process.env.OPENSEA_APIKEY! }
  const apiURL = new URL('https://api.opensea.io/v2/orders/ethereum/seaport/listings')
  const orders: OrderRecordV2[] = []
  const fetchOrders = async () => {
    try {
      const data = await fetchJSON(apiURL.toString(), { method: 'GET', headers: headers })
      const r = data as OpenseaListingsResponseV2
      if (r.orders) {
        const os = r.orders
          .map((o) => {
            ;(o as any).asset = {}
            ;(o as any).asset.token_id = o.protocol_data.parameters.offer[0]?.identifierOrCriteria
            return o
          })
          .filter((o: any) => !!o.asset?.token_id && o.order_type != 'basic') // no fixed-price
        orders.push(...os)
      }
    } catch (err) {
      log.error(err)
      return {
        kind: 'possibleClientErrorNotSureLol',
      }
    }
  }

  if (config.token_ids.length <= 30) {
    apiURL.search = querystring.stringify(c)
    await fetchOrders()
  } else if (config.token_ids?.length > 30) {
    // Only 50 tokens at a time
    const chunked = chunk(config.token_ids, 30)

    for (const tempIds of chunked) {
      apiURL.search = querystring.stringify(Object.assign(c, { token_ids: tempIds }))

      await fetchOrders()
    }
  }

  return {
    type: 'success',
    orders,
  }
}
