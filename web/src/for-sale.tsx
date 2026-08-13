import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Toggle from './components/toggle'
import Head from './components/head'
import { ParcelDetails } from './components/parcels/parcel-details'
import { Womp, WompCard } from './components/womp-card'
import cachedFetch from './helpers/cached-fetch'
import { fetchOptions } from './utils'
import WorldMap from './map'
import type { ParcelRecord } from '../../common/messages/parcel'
import { truncate } from './lib/string-utils'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { floor: number; fresh: Item[]; secondary: Item[]; deals: Item[] }
// "new" is the default (mints pay the bills); "all" is every listing - mints + resales together.
// one market, not us-vs-them.
type Tab = 'fresh' | 'all'

const LABELS: Record<Tab, string> = { fresh: 'new', all: 'all' }
const CLASSIFIEDS_URL = '/api/classifieds.json'
const eth = (n: number) => parseFloat(n.toFixed(3))
const DETAIL_MAP_ORTHO = 200
const WOMP_PAGE = 6

const selectedFromUrl = () => {
  if (typeof location === 'undefined') return null
  const p = new URLSearchParams(location.search).get('parcel')
  if (!p) return null
  const id = parseInt(p, 10)
  return Number.isFinite(id) ? id : null
}

function RecentWomps({ parcelId }: { parcelId: number }) {
  const [womps, setWomps] = useState<Womp[]>([])
  const [limit, setLimit] = useState(WOMP_PAGE)

  useEffect(() => setLimit(WOMP_PAGE), [parcelId])

  useEffect(() => {
    let live = true
    cachedFetch(`/api/womps/at/parcel/${parcelId}.json?limit=${limit}`, fetchOptions(), 60)
      .then((r) => r.json())
      .then((r) => live && r.success && setWomps(r.womps))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [parcelId, limit])

  if (!womps.length) return null
  const hasMore = womps.length >= limit
  return (
    <div class="for-sale-womps">
      <h4>recent womps</h4>
      <div class="parcel-womps-grid">
        {womps.map((w) => (
          <WompCard key={w.id} womp={w} />
        ))}
      </div>
      {hasMore ? (
        <button type="button" class="womps-show-more" onClick={() => setLimit((n) => n + WOMP_PAGE)}>
          show more
        </button>
      ) : null}
    </div>
  )
}

export default function ForSale(_props: { path?: string }) {
  const initialId = selectedFromUrl()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('fresh')
  const [usd, setUsd] = useState(false)
  const [rate, setRate] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(initialId)
  const [view, setView] = useState<'list' | 'detail'>(initialId ? 'detail' : 'list')
  const [parcel, setParcel] = useState<ParcelRecord | undefined>()
  const [visibleIds, setVisibleIds] = useState<number[] | null>(null)
  const mapRef = useRef<WorldMap | null>(null)

  const showTabs = !!(data && data.fresh.length > 0 && data.secondary.length > 0)
  const active: Tab = showTabs ? tab : 'all'

  useEffect(() => {
    cachedFetch(CLASSIFIEDS_URL)
      .then((r) => r.json())
      .then((d) => d.success && setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
      .then((r) => r.json())
      .then((d) => setRate(parseFloat(d?.data?.amount) || 0))
      .catch(() => {})
  }, [])

  const fmt = (price: number) => (!usd || !rate ? `${eth(price)}Ξ` : `$${parseFloat((price * rate).toFixed(0))}`)

  const isValid = (i: Item) => i.price > 0 && i.price < 4.2

  const allItems = useMemo(() => {
    if (!data) return []
    const seen = new Set<number>()
    const source = active === 'fresh' ? data.fresh : [...data.fresh, ...data.secondary]
    return source
      .filter(isValid)
      .filter((i) => {
        if (seen.has(i.id)) return false
        seen.add(i.id)
        return true
      })
      .sort((a, b) => a.price - b.price)
  }, [data, active])

  const forSale = useMemo(() => allItems.map((i) => ({ id: i.id, price: i.price, label: fmt(i.price) })), [allItems, usd, rate])
  const selectedItem = selectedId ? allItems.find((i) => i.id === selectedId) : undefined

  useEffect(() => {
    if (view !== 'detail' || !selectedId) {
      setParcel(undefined)
      return
    }
    let live = true
    cachedFetch(`/api/parcels/${selectedId}.json`, fetchOptions())
      .then((r) => r.json())
      .then((r) => live && r.parcel && setParcel(r.parcel))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [view, selectedId])

  const select = (id: number) => {
    setSelectedId(id)
    setView('detail')
    if (typeof location !== 'undefined') {
      const u = new URL(location.href)
      u.searchParams.set('parcel', String(id))
      history.replaceState(null, '', u.pathname + u.search)
    }
    mapRef.current?.focusParcel(id, DETAIL_MAP_ORTHO)
  }

  const back = () => {
    setView('list')
    setSelectedId(null)
    setParcel(undefined)
    if (typeof location !== 'undefined') {
      const u = new URL(location.href)
      u.searchParams.delete('parcel')
      history.replaceState(null, '', u.pathname + u.search)
    }
    mapRef.current?.resetShopListView()
  }

  useEffect(() => {
    if (view !== 'detail' || !selectedId) return
    mapRef.current?.focusParcel(selectedId, DETAIL_MAP_ORTHO)
  }, [view, selectedId, allItems.length])

  return (
    <section class="columns for-sale">
      <Head title="Parcels for sale" url="/shop" />

      <article>
        <WorldMap ref={mapRef} forSale={forSale} selectedForSale={selectedId} onForSaleSelect={select} onForSaleViewportChange={setVisibleIds} priceFmt={`${usd}-${rate}`} />
      </article>
      <aside class="for-sale-list">
        {view === 'detail' ? (
          <>
            <header class="for-sale-head for-sale-head-detail">
              <button type="button" class="for-sale-back" onClick={back}>
                Back to listings
              </button>
              <div class="for-sale-currency">
                <span class={!usd ? 'active' : ''}>eth</span>
                <Toggle checked={usd} onChange={setUsd} />
                <span class={usd ? 'active' : ''}>usd</span>
              </div>
            </header>
            <div class="for-sale-detail">
              {parcel ? (
                <>
                  <h2>{parcel.name || parcel.address || `#${selectedId}`}</h2>
                  {selectedItem ? <p class="for-sale-detail-price">{fmt(selectedItem.price)}</p> : null}
                  {selectedItem?.permalink ? (
                    <a class="buttonish" href={selectedItem.permalink} target="_blank">
                      Buy for {fmt(selectedItem.price)}
                    </a>
                  ) : null}
                  <RecentWomps parcelId={parcel.id} />
                  <ParcelDetails parcel={parcel} />
                </>
              ) : (
                <p>loading...</p>
              )}
            </div>
          </>
        ) : (
          <>
            <header class="for-sale-head">
              <div>
                <h2>Shop</h2>
                <p>
                  {loading ? 'loading listings...' : `${allItems.length} listings`}
                  {data && data.floor ? ` - floor ${fmt(data.floor)}` : ''}
                </p>
              </div>
            </header>
            {showTabs && (
              <nav class="classifieds-tabs">
                {(['fresh', 'all'] as Tab[]).map((t) => (
                  <button key={t} class={active === t ? 'active' : ''} onClick={() => setTab(t)}>
                    {LABELS[t]}
                  </button>
                ))}
              </nav>
            )}
            <table>
              <thead>
                <tr>
                  <th>name</th>
                  <th class="price">price</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((i) => (
                  <tr
                    key={i.id}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={(e: any) => {
                      e.preventDefault()
                      select(i.id)
                    }}
                    onMouseEnter={() => mapRef.current?.highlightParcel(i.id)}
                    onMouseLeave={() => mapRef.current?.highlightParcel(null)}
                  >
                    <td>{truncate(i.name || i.address || `#${i.id}`, 30)}</td>
                    <td class="price">{fmt(i.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
    </section>
  )
}
