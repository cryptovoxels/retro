import { useEffect, useState } from 'preact/hooks'
import cachedFetch, { invalidateUrl } from '../helpers/cached-fetch'
import { parcelContract, parcelSigner, sendMint, TEAM } from '../helpers/mint-parcel'

type Row = { id: number; address: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export default function Unminted() {
  const [rows, setRows] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const url = `/api/admin/parcels/unminted?page=${page}`

  async function load() {
    try {
      const r = await cachedFetch(url)
      const d = await r.json()
      setRows(d.parcels || [])
      setSel(new Set())
    } catch (e: any) {
      setErr(e?.toString() || 'failed to load')
    }
  }

  useEffect(() => {
    load()
  }, [page])

  function toggle(id: number) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSel(sel.size === rows.length ? new Set() : new Set(rows.map((p) => p.id)))
  }

  async function resync() {
    setBusy('resyncing...')
    setErr('')
    try {
      await fetch(`/api/parcels/by/${TEAM}/query`)
      invalidateUrl(url)
      await load()
    } catch (e: any) {
      setErr(e?.toString() || 'resync failed')
    } finally {
      setBusy('')
    }
  }

  async function mintSelected() {
    const selected = rows.filter((p) => sel.has(p.id))
    if (!selected.length) return
    setBusy(`minting 0/${selected.length}...`)
    setErr('')
    const txs: { id: number; tx: any }[] = []
    try {
      const c = await parcelContract()
      const from = (await (await parcelSigner()).getAddress()).toLowerCase()
      const owner = (await c.owner()).toLowerCase()
      if (from !== owner) {
        setErr(`wrong wallet: contract owner is ${owner}, you are ${from}`)
        return
      }
      for (let i = 0; i < selected.length; i++) {
        const p = selected[i]
        setBusy(`minting ${i + 1}/${selected.length}...`)
        if (await c.exists(p.id)) {
          await fetch(`/api/parcels/${p.id}/query`)
          continue
        }
        try {
          txs.push({ id: p.id, tx: await sendMint(c, p) })
        } catch (e: any) {
          setErr(e?.shortMessage || e?.toString() || 'mint failed')
          break
        }
      }
      if (txs.length) {
        setBusy(`waiting for ${txs.length} tx...`)
        await Promise.all(txs.map((t) => t.tx.wait()))
        await Promise.all(txs.map((t) => fetch(`/api/parcels/${t.id}/query`)))
      }
      invalidateUrl(url)
      await load()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.toString() || 'mint failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div class="admin-section">
      <p>unminted parcels in the db. mint pushes them on-chain to the team wallet at 0 eth.</p>
      {err && <p class="admin-err">{err}</p>}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button disabled={!!busy || !sel.size} onClick={mintSelected}>
          {busy || `mint selected (${sel.size})`}
        </button>
        <button disabled={!!busy} onClick={resync}>
          resync
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>
              <input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} />
            </th>
            <th>id</th>
            <th>address</th>
            <th>island</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
              </td>
              <td>
                <a href={`/parcels/${p.id}`}>{p.id}</a>
              </td>
              <td>{p.address}</td>
              <td>{p.island}</td>
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
