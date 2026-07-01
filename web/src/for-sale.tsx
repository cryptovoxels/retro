import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import Toggle from './components/toggle'
import Head from './components/head'
import cachedFetch from './helpers/cached-fetch'
import WorldMap from './map'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { floor: number; fresh: Item[]; secondary: Item[]; deals: Item[] }

const URL = process.env.NODE_ENV === 'production' ? '/api/classifieds.json' : 'https://www.voxels.com/api/classifieds.json'
const eth = (n: number) => parseFloat(n.toFixed(3))

const selectedFromUrl = () => {
  if (typeof location === 'undefined') return null
  const p = new URLSearchParams(location.search).get('parcel')
  if (!p) return null
  const id = parseInt(p, 10)
  return Number.isFinite(id) ? id : null
}

// zillow-style browse for land that's actually listed: map on the left, listings on the right.
// pick a row (or land from the homepage shop widget with ?parcel=) and the map zooms there;
// buy only shows on the selected row and links out to opensea.
export default function ForSale(_props: { path?: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [usd, setUsd] = useState(false)
  const [rate, setRate] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(selectedFromUrl)
  const mapRef = useRef<WorldMap | null>(null)

  useEffect(() => {
    cachedFetch(URL)
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

  // every current listing, cheapest first, deduped. memoized so the usd toggle doesn't churn map pins
  const items = useMemo(() => {
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

  const forSale = useMemo(() => items.map((i) => ({ id: i.id, price: i.price })), [items])

  const select = (id: number) => {
    setSelectedId(id)
    if (typeof location !== 'undefined') {
      const u = new URL(location.href)
      u.searchParams.set('parcel', String(id))
      history.replaceState(null, '', u.pathname + u.search)
    }
    mapRef.current?.focusParcel(id)
  }

  // homepage shop links land here with ?parcel=; zoom once listings + map pins exist
  useEffect(() => {
    if (!selectedId || !items.length) return
    mapRef.current?.focusParcel(selectedId)
    document.querySelector('.for-sale-card.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, items.length])

  return (
    <section class="for-sale">
      <Head title="Land for sale" url="/shop" />
      <div class="for-sale-map">
        <WorldMap ref={mapRef} forSale={forSale} selectedForSale={selectedId} onForSaleSelect={select} />
      </div>
      <aside class="for-sale-list">
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
            <div class={`for-sale-card${selectedId === i.id ? ' selected' : ''}`} key={i.id}>
              <a
                href={`/shop?parcel=${i.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  select(i.id)
                }}
                onMouseEnter={() => mapRef.current?.highlightParcel(i.id)}
                onMouseLeave={() => mapRef.current?.highlightParcel(selectedId)}
              >
                <div class="addr">{i.name || i.address || `#${i.id}`}</div>
                {i.name && i.address ? <div class="sub">{i.address}</div> : null}
                <div class="price">{fmt(i.price)}</div>
              </a>
              {selectedId === i.id && i.permalink ? (
                <a class="for-sale-buy" href={i.permalink} target="_blank" rel="noopener noreferrer">
                  buy
                </a>
              ) : null}
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}
