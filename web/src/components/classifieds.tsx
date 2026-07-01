import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'
import Toggle from './toggle'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { fresh: Item[]; secondary: Item[]; deals: Item[] }
type Tab = 'fresh' | 'secondary' | 'deals'
type Sort = 'name' | 'address' | 'price'

const LABELS: Record<Tab, string> = { fresh: 'freshly minted', secondary: 'secondary', deals: 'deals' }
const URL = process.env.NODE_ENV === 'production' ? '/api/classifieds.json' : 'https://www.voxels.com/api/classifieds.json'
const eth = (n: number) => parseFloat(n.toFixed(3))
const name = (i: Item) => i.name || i.address || `#${i.id}`

type Props = { limit?: number; link?: boolean }

export default function Classifieds({ limit, link = true }: Props) {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('secondary')
  const [sort, setSort] = useState<Sort>('price')
  const [asc, setAsc] = useState(true)
  const [usd, setUsd] = useState(false)
  const [rate, setRate] = useState(0)

  useEffect(() => {
    cachedFetch(URL)
      .then((r) => r.json())
      .then((d) => d.success && setData(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (limit) return
    fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
      .then((r) => r.json())
      .then((d) => setRate(parseFloat(d?.data?.amount) || 0))
      .catch(() => {})
  }, [limit])

  if (!data || (!data.fresh.length && !data.secondary.length && !data.deals.length)) return null

  const tabs = (['fresh', 'secondary', 'deals'] as Tab[]).filter((t) => t !== 'fresh' || data.fresh.length)
  const active = tabs.includes(tab) ? tab : tabs[0]

  const toggleSort = (field: Sort) => {
    if (sort === field) setAsc(!asc)
    else {
      setSort(field)
      setAsc(true)
    }
  }

  const sorted = [...data[active]].sort((a, b) => {
    let av: string | number
    let bv: string | number
    if (sort === 'name') {
      av = name(a).toLowerCase()
      bv = name(b).toLowerCase()
    } else if (sort === 'address') {
      av = (a.address || '').toLowerCase()
      bv = (b.address || '').toLowerCase()
    } else {
      av = a.price
      bv = b.price
    }
    if (av < bv) return asc ? -1 : 1
    if (av > bv) return asc ? 1 : -1
    return 0
  })

  const items = limit ? sorted.slice(0, limit) : sorted

  const fmt = (price: number) => {
    if (!usd || !rate) return `${eth(price)}Ξ`
    return `$${parseFloat((price * rate).toFixed(2))}`
  }

  const th = (field: Sort, label: string) => (
    <th scope="col" class={`-sortable${sort === field ? ' -sorted' : ''}`} onClick={() => toggleSort(field)}>
      {label}
    </th>
  )

  return (
    <div class="classifieds">
      <div class="classifieds-head">
        <h3>{link ? <a href="/shop">shop</a> : 'shop'}</h3>
        {!limit && (
          <div class="classifieds-currency">
            <span class={!usd ? 'active' : ''}>eth</span>
            <Toggle checked={usd} onChange={setUsd} />
            <span class={usd ? 'active' : ''}>usd</span>
          </div>
        )}
      </div>
      <nav class="classifieds-tabs">
        {tabs.map((t) => (
          <button key={t} class={active === t ? 'active' : ''} onClick={() => setTab(t)}>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      <table class="clipped">
        <thead>
          <tr>
            {th('name', 'name')}
            {th('address', 'address')}
            {th('price', 'price')}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3}>nothing here yet.</td>
            </tr>
          ) : (
            items.map((i) => (
              <tr key={i.id}>
                <td>
                  <a href={`/parcels/${i.id}`}>{name(i)}</a>
                </td>
                <td>{i.address}</td>
                <td>{fmt(i.price)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
