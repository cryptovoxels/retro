import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'
import Toggle from './toggle'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { fresh: Item[]; secondary: Item[] }
type Tab = 'fresh' | 'secondary'
type Sort = 'name' | 'address' | 'price'

const LABELS: Record<Tab, string> = { fresh: 'new', secondary: 'used' }
const URL = '/api/classifieds.json'
const eth = (n: number) => parseFloat(n.toFixed(3))
const name = (i: Item) => i.name || i.address || `#${i.id}`

type Props = { limit?: number }

export default function Classifieds({ limit }: Props) {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('fresh')
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

  if (!data || (!data.fresh.length && !data.secondary.length)) return null

  const showTabs = data.fresh.length > 0 && data.secondary.length > 0
  const active: Tab = showTabs ? (tab === 'fresh' ? 'fresh' : 'secondary') : data.fresh.length ? 'fresh' : 'secondary'

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

  return (
    <div class="classifieds">
      <br />
      <br />
      <div class="classifieds-head">
        {!limit && (
          <div class="classifieds-currency">
            <span class={!usd ? 'active' : ''}>eth</span>
            <Toggle checked={usd} onChange={setUsd} />
            <span class={usd ? 'active' : ''}>usd</span>
          </div>
        )}
      </div>
      {showTabs && (
        <nav class="classifieds-tabs">
          {(['fresh', 'secondary'] as Tab[]).map((t) => (
            <button key={t} class={active === t ? 'active' : ''} onClick={() => setTab(t)}>
              {LABELS[t]}
            </button>
          ))}
        </nav>
      )}
      <table class="clipped">
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3}>nothing here yet.</td>
            </tr>
          ) : (
            items.map((i) => (
              <tr key={i.id}>
                <td>
                  <a href={`/shop?parcel=${i.id}`}>{name(i)}</a>
                </td>
                <td>{fmt(i.price)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
