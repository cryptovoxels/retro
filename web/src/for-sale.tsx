import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Toggle from './components/toggle'
import Head from './components/head'
import { ParcelDetails } from './components/parcels/parcel-details'
import { Womp, WompCard } from './components/womp-card'
import cachedFetch from './helpers/cached-fetch'
import { fetchOptions } from './utils'
import WorldMap from './map'
import type { ParcelRecord } from '../../common/messages/parcel'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { floor: number; fresh: Item[]; secondary: Item[]; deals: Item[] }

const CLASSIFIEDS_URL = '/api/classifieds.json'
const eth = (n: number) => parseFloat(n.toFixed(3))
const DETAIL_MAP_ZOOM = 17
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
  const [data, setData] = useState<Data | null>(null)
  const [usd, setUsd] = useState(false)
  const [rate, setRate] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(initialId)
  const [view, setView] = useState<'list' | 'detail'>(initialId ? 'detail' : 'list')
  const [parcel, setParcel] = useState<ParcelRecord | undefined>()
  const [visibleIds, setVisibleIds] = useState<number[] | null>(null)
  const mapRef = useRef<WorldMap | null>(null)

  useEffect(() => {
    cachedFetch(CLASSIFIEDS_URL)
      .then((r) => r.json())
      .then((d) => d.success && setData(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
      .then((r) => r.json())
      .then((d) => setRate(parseFloat(d?.data?.amount) || 0))
      .catch(() => {})
  }, [])

  const fmt = (price: number) => (!usd || !rate ? `${eth(price)}Ξ` : `$${parseFloat((price * rate).toFixed(2))}`)

  const allItems = useMemo(() => {
    if (!data) return []
    const seen = new Set<number>()
    return [...data.fresh, ...data.secondary]
      .filter((i) => {
        if (seen.has(i.id)) return false
        seen.add(i.id)
        return true
      })
      .sort((a, b) => a.price - b.price)
  }, [data])

  const items = useMemo(() => {
    if (visibleIds === null) return allItems
    const inView = new Set(visibleIds)
    return allItems.filter((i) => inView.has(i.id) || i.id === selectedId)
  }, [allItems, visibleIds, selectedId])

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
    mapRef.current?.focusParcel(id, DETAIL_MAP_ZOOM)
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
    mapRef.current?.highlightParcel(null)
  }

  useEffect(() => {
    if (view !== 'detail' || !selectedId) return
    mapRef.current?.focusParcel(selectedId, DETAIL_MAP_ZOOM)
  }, [view, selectedId, items.length])

  return (
    <section class="for-sale">
      <Head title="Land for sale" url="/shop" />
      <div class="for-sale-map">
        <WorldMap
          ref={mapRef}
          forSale={forSale}
          selectedForSale={selectedId}
          onForSaleSelect={select}
          onForSaleViewportChange={setVisibleIds}
        />
      </div>
      <aside class="for-sale-list">
        {view === 'detail' ? (
          <>
            <header class="for-sale-head">
              <button type="button" class="for-sale-back" onClick={back}>
                back
              </button>
            </header>
            <div class="for-sale-detail">
              {parcel ? (
                <>
                  <h2>{parcel.name || parcel.address || `#${selectedId}`}</h2>
                  {selectedItem ? <p class="for-sale-detail-price">{fmt(selectedItem.price)}</p> : null}
                  {selectedItem?.permalink ? (
                    <a class="for-sale-buy" href={selectedItem.permalink} target="_blank" rel="noopener noreferrer">
                      buy
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
                <h2>land for sale</h2>
                <p>
                  {items.length ? `${items.length} listings` : 'loading listings...'}
                  {data && data.floor ? ` - floor ${fmt(data.floor)}` : ''}
                </p>
              </div>
              <div class="for-sale-currency">
                <span class={!usd ? 'active' : ''}>eth</span>
                <Toggle checked={usd} onChange={setUsd} />
                <span class={usd ? 'active' : ''}>usd</span>
              </div>
            </header>
            <div class="for-sale-cards">
              {items.map((i) => (
                <a
                  class="for-sale-card"
                  key={i.id}
                  href={`/shop?parcel=${i.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    select(i.id)
                  }}
                  onMouseEnter={() => mapRef.current?.highlightParcel(i.id)}
                  onMouseLeave={() => mapRef.current?.highlightParcel(null)}
                >
                  <div class="addr">{i.name || i.address || `#${i.id}`}</div>
                  {i.name && i.address ? <div class="sub">{i.address}</div> : null}
                  <div class="price">{fmt(i.price)}</div>
                </a>
              ))}
            </div>
          </>
        )}
      </aside>
    </section>
  )
}
