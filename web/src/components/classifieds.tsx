import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'

type Item = { id: number; name: string | null; address: string; price: number; permalink: string }
type Data = { fresh: Item[]; secondary: Item[]; deals: Item[] }
type Tab = 'fresh' | 'secondary' | 'deals'

const LABELS: Record<Tab, string> = { fresh: 'freshly minted', secondary: 'secondary', deals: 'deals' }

export default function Classifieds() {
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('fresh')

  useEffect(() => {
    cachedFetch('/api/classifieds.json')
      .then((r) => r.json())
      .then((d) => d.success && setData(d))
      .catch(() => {})
  }, [])

  if (!data || (!data.fresh.length && !data.secondary.length && !data.deals.length)) return null

  const items = data[tab]

  return (
    <div class="classifieds">
      <h3>For sale</h3>
      <nav class="classifieds-tabs">
        {(['fresh', 'secondary', 'deals'] as Tab[]).map((t) => (
          <button key={t} class={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      <div class="wrap-grid">
        {items.map((i) => (
          <a class="classified" key={i.id} href={i.permalink} target="_blank" rel="noopener noreferrer">
            <img loading="lazy" src={`/api/parcels/${i.id}.png`} alt={i.name || i.address} />
            <b>{i.name || i.address || `#${i.id}`}</b>
            <small>{i.price}Ξ</small>
          </a>
        ))}
        {items.length === 0 && <p>nothing here yet.</p>}
      </div>
    </div>
  )
}
