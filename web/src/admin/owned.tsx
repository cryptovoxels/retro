import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'
import { Fee, listOnOpensea } from '../helpers/list-opensea'

const TEAM = '0x2D891ED45C4C3EAB978513DF4B92a35Cf131d2e2'

type Parcel = { id: number; name?: string; address: string }
type Config = { floor: number; volume30d: number; suggested: number; fees: Fee[] }

export default function Owned() {
  const [parcels, setParcels] = useState<Parcel[]>([])
  const [config, setConfig] = useState<Config | null>(null)
  const [price, setPrice] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<Record<number, string>>({})

  useEffect(() => {
    cachedFetch(`/api/wallet/${TEAM}/parcels.json`)
      .then((r) => r.json())
      .then((d) => setParcels(d.parcels || []))
      .catch(() => {})
    cachedFetch('/api/admin/opensea/stats')
      .then((r) => r.json())
      .then((d) => d.success && setConfig(d))
      .catch(() => {})
  }, [])

  const suggested = config?.suggested || 0

  async function list(p: Parcel) {
    const value = price[p.id] || String(suggested || '')
    if (!value || Number(value) <= 0) {
      setMsg((m) => ({ ...m, [p.id]: 'set a price' }))
      return
    }
    setBusy(p.id)
    setMsg((m) => ({ ...m, [p.id]: '' }))
    try {
      await listOnOpensea(p.id, value, config?.fees || [])
      setMsg((m) => ({ ...m, [p.id]: 'listed!' }))
    } catch (e: any) {
      setMsg((m) => ({ ...m, [p.id]: e?.shortMessage || e?.toString() || 'failed' }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="admin-section">
      <p>
        parcels owned by the team wallet. floor {config ? `${config.floor} eth` : '...'} / 30d vol {config ? `${config.volume30d} eth` : '...'} / suggested {suggested} eth.
      </p>
      <div class="wrap-grid">
        {parcels.map((p) => (
          <div class="admin-card" key={p.id}>
            <a href={`/parcels/${p.id}`}>
              <img loading="lazy" src={`/api/parcels/${p.id}.png`} alt={p.name || p.address} />
            </a>
            <b>{p.name || p.address}</b>
            <div class="f">
              <input type="number" step="0.001" min="0" placeholder={String(suggested)} value={price[p.id] ?? ''} onInput={(e: any) => setPrice((m) => ({ ...m, [p.id]: e.currentTarget.value }))} />
              <button disabled={busy === p.id} onClick={() => list(p)}>
                {busy === p.id ? 'listing...' : 'list on opensea'}
              </button>
            </div>
            {msg[p.id] && <small>{msg[p.id]}</small>}
          </div>
        ))}
      </div>
    </div>
  )
}
