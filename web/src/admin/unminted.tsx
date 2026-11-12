import { useEffect, useState } from 'preact/hooks'
import cachedFetch from '../helpers/cached-fetch'
import { parcelContract, parcelSigner, sendMint, TEAM } from '../helpers/mint-parcel'

type Row = { id: number; address: string; island: string; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }

export default function Unminted() {
  const [rows, setRows] = useState<Row[]>([])
  const [address, setAddress] = useState('')
  const [page, setPage] = useState(0)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<{ key: 'id' | 'address' | 'island'; desc: boolean }>({ key: 'id', desc: false })
  const [last, setLast] = useState<number | null>(null)

  const sorted = [...rows].sort((a, b) => {
    const r = a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0
    return sort.desc ? -r : r
  })

  function sortBy(key: 'id' | 'address' | 'island') {
    setSort((s) => ({ key, desc: s.key === key && !s.desc }))
  }

  function arrow(key: string) {
    return sort.key === key ? (sort.desc ? ' v' : ' ^') : ''
  }

  const query = address.trim()
  useEffect(() => {
    const controller = new AbortController()
    setRows([])
    setSel(new Set())
    setLast(null)
    setErr('')
    const timer = setTimeout(
      async () => {
        try {
          const url = `/api/admin/parcels/unminted?page=${page}&address=${encodeURIComponent(query)}`
          const r = await cachedFetch(url, { signal: controller.signal })
          const d = await r.json()
          if (!controller.signal.aborted) setRows(d.parcels || [])
        } catch (e: any) {
          if (!controller.signal.aborted) setErr(e?.toString() || 'failed to load')
        }
      },
      query ? 250 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [page, query])

  function toggle(id: number, shift: boolean) {
    const ids = sorted.map((p) => p.id)
    const i = ids.indexOf(id)
    const j = last == null ? -1 : ids.indexOf(last)
    setSel((prev) => {
      const next = new Set(prev)
      if (shift && j >= 0) {
        const on = !next.has(id)
        for (let k = Math.min(i, j); k <= Math.max(i, j); k++) on ? next.add(ids[k]) : next.delete(ids[k])
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setLast(id)
  }

  function toggleAll() {
    setSel(sel.size === rows.length ? new Set() : new Set(rows.map((p) => p.id)))
  }

  function removeIds(ids: number[]) {
    const gone = new Set(ids)
    setRows((rs) => rs.filter((p) => !gone.has(p.id)))
    setSel((s) => {
      const next = new Set(s)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  async function removeAlreadyMinted() {
    setBusy('checking chain...')
    setErr('')
    try {
      console.log('[unminted] removeAlreadyMinted start', TEAM)
      await fetch(`/api/parcels/by/${TEAM}/query`).catch(() => {})
      const c = await parcelContract()
      const gone: number[] = []
      for (const p of rows) {
        if (await c.exists(p.id)) gone.push(p.id)
      }
      console.log('[unminted] removing already-minted from list', gone)
      removeIds(gone)
      setErr(gone.length ? `removed ${gone.length} already-minted from this list` : 'none on this page are minted yet')
    } catch (e: any) {
      console.error('[unminted] removeAlreadyMinted failed', e)
      setErr(e?.toString() || 'check failed')
    } finally {
      setBusy('')
    }
  }

  async function mintSelected() {
    const selected = rows.filter((p) => sel.has(p.id))
    console.log('[unminted] mintSelected click', { selSize: sel.size, selected: selected.map((p) => ({ id: p.id, x1: p.x1, y1: p.y1, z1: p.z1, x2: p.x2, y2: p.y2, z2: p.z2 })) })
    if (!selected.length) {
      setErr('nothing selected')
      return
    }
    setBusy(`minting 0/${selected.length}...`)
    setErr('')
    const txs: { id: number; tx: any }[] = []
    const skipped: number[] = []
    try {
      console.log('[unminted] getting contract...')
      const c = await parcelContract()
      const from = (await (await parcelSigner()).getAddress()).toLowerCase()
      const owner = (await c.owner()).toLowerCase()
      console.log('[unminted] wallet check', { from, owner, match: from === owner })
      if (from !== owner) {
        setErr(`wrong wallet: contract owner is ${owner}, you are ${from}`)
        return
      }
      for (let i = 0; i < selected.length; i++) {
        const p = selected[i]
        setBusy(`minting ${i + 1}/${selected.length}...`)
        console.log('[unminted] parcel', i + 1, '/', selected.length, p)
        const exists = await c.exists(p.id)
        console.log('[unminted] exists?', p.id, exists)
        if (exists) {
          console.warn('[unminted] SKIP already on-chain', p.id)
          skipped.push(p.id)
          continue
        }
        try {
          console.log('[unminted] calling sendMint', p.id, '- MetaMask should pop now')
          const tx = await sendMint(c, p)
          console.log('[unminted] sendMint returned', p.id, tx?.hash)
          txs.push({ id: p.id, tx })
        } catch (e: any) {
          console.error('[unminted] sendMint failed', p.id, e)
          setErr(e?.shortMessage || e?.reason || e?.toString() || 'mint failed')
          break
        }
      }
      console.log('[unminted] loop done', { sent: txs.length, skipped })
      // prod db is stale — yank skipped/minted rows out of the UI instead of reloading them
      if (skipped.length) removeIds(skipped)
      if (!txs.length && skipped.length) {
        setErr(`all ${skipped.length} already minted on-chain. removed from this list.`)
        return
      }
      if (txs.length) {
        setBusy(`waiting for ${txs.length} tx...`)
        console.log(
          '[unminted] waiting for receipts',
          txs.map((t) => t.tx.hash),
        )
        await Promise.all(txs.map((t) => t.tx.wait()))
        removeIds(txs.map((t) => t.id))
        console.log('[unminted] all mined')
      }
    } catch (e: any) {
      console.error('[unminted] mintSelected fatal', e)
      setErr(e?.shortMessage || e?.reason || e?.toString() || 'mint failed')
    } finally {
      console.log('[unminted] mintSelected finally')
      setBusy('')
    }
  }

  return (
    <div class="admin-section">
      <p>unminted parcels in the db. mint pushes them on-chain to the team wallet at 0 eth.</p>
      <div class="f">
        <label for="unminted-address">search by address</label>
        <input
          id="unminted-address"
          type="search"
          value={address}
          disabled={!!busy}
          onInput={(e) => {
            setAddress(e.currentTarget.value)
            setPage(0)
          }}
        />
      </div>
      {err && <p class="admin-err">{err}</p>}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button disabled={!!busy || !sel.size} onClick={mintSelected}>
          {busy || `mint selected (${sel.size})`}
        </button>
        <button disabled={!!busy || !rows.length} onClick={removeAlreadyMinted}>
          {busy === 'checking chain...' ? 'checking chain...' : 'remove already minted'}
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>
              <input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} />
            </th>
            <th style={{ cursor: 'pointer' }} onClick={() => sortBy('id')}>
              id{arrow('id')}
            </th>
            <th style={{ cursor: 'pointer' }} onClick={() => sortBy('address')}>
              address{arrow('address')}
            </th>
            <th style={{ cursor: 'pointer' }} onClick={() => sortBy('island')}>
              island{arrow('island')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id}>
              <td>
                <input type="checkbox" checked={sel.has(p.id)} onClick={(e: any) => toggle(p.id, e.shiftKey)} />
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
