import { useEffect, useState } from 'preact/hooks'
import cachedFetch, { invalidateUrl } from '../helpers/cached-fetch'
import { mintParcel } from '../helpers/mint-parcel'

type Row = { id: number; address: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export default function Unminted() {
  const [rows, setRows] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')

  const url = `/api/admin/parcels/unminted?page=${page}`

  async function load() {
    try {
      const r = await cachedFetch(url)
      const d = await r.json()
      setRows(d.parcels || [])
    } catch (e: any) {
      setErr(e?.toString() || 'failed to load')
    }
  }

  useEffect(() => {
    load()
  }, [page])

  async function mint(p: Row) {
    setBusy(p.id)
    setErr('')
    try {
      await mintParcel(p)
      // sync our db with the chain so minted flips true and it leaves this list
      await fetch(`/api/parcels/${p.id}/query`)
      invalidateUrl(url)
      await load()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.toString() || 'mint failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="admin-section">
      <p>unminted parcels in the db. mint pushes them on-chain to the team wallet at 0 eth.</p>
      {err && <p class="admin-err">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>address</th>
            <th>island</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <a href={`/parcels/${p.id}`}>{p.id}</a>
              </td>
              <td>{p.address}</td>
              <td>{p.island}</td>
              <td>
                <button disabled={busy === p.id} onClick={() => mint(p)}>
                  {busy === p.id ? 'minting...' : 'mint'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="admin-pager">
        <button disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>
          prev
        </button>
        <span>page {page + 1}</span>
        <button disabled={rows.length < 100} onClick={() => setPage((n) => n + 1)}>
          next
        </button>
      </div>
    </div>
  )
}
