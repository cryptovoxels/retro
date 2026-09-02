import { useEffect, useState } from 'preact/hooks'
import { invalidateUrl } from '../helpers/cached-fetch'
import cachedFetch from '../helpers/cached-fetch'

type Row = { id: number; address?: string; name?: string; island?: string; sandbox?: boolean }

export default function SandboxesAdmin() {
  const [current, setCurrent] = useState<Row[]>([])
  const [suggest, setSuggest] = useState<Row[]>([])
  const [parcelId, setParcelId] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      const [a, b] = await Promise.all([cachedFetch('/api/sandboxes.json'), cachedFetch('/api/admin/sandboxes/suggest')])
      const sandboxes = await a.json()
      const suggestions = await b.json()
      setCurrent(sandboxes.sandboxes || [])
      setSuggest(suggestions.parcels || [])
    } catch {
      setMsg('failed to load')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function setSandbox(id: number, sandbox: boolean) {
    setBusy(id)
    setMsg('')
    try {
      const r = await fetch(`/api/admin/parcels/${id}/sandbox`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox }),
      })
      const d = await r.json()
      if (!d?.success) {
        setMsg(d?.error || 'failed')
        return
      }
      invalidateUrl('/api/sandboxes.json')
      invalidateUrl('/api/admin/sandboxes/suggest')
      await load()
    } catch (e: any) {
      setMsg(e?.toString?.() || 'failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="admin-section">
      <p>open or close sandboxes. anyone can edit an open sandbox.</p>
      {msg && <p>{msg}</p>}

      <div class="f">
        <label>parcel id</label>
        <input type="number" value={parcelId} onInput={(e: any) => setParcelId(e.currentTarget.value)} />
        <button
          disabled={!parcelId || busy !== null}
          onClick={() => {
            const id = parseInt(parcelId, 10)
            if (!isNaN(id)) setSandbox(id, true)
          }}
        >
          open
        </button>
        <button
          disabled={!parcelId || busy !== null}
          onClick={() => {
            const id = parseInt(parcelId, 10)
            if (!isNaN(id)) setSandbox(id, false)
          }}
        >
          close
        </button>
      </div>

      <h2>open sandboxes</h2>
      <ul>
        {current.map((p) => (
          <li key={p.id}>
            <a href={`/parcels/${p.id}`}>{p.name || p.address || p.id}</a>{' '}
            <button disabled={busy === p.id} onClick={() => setSandbox(p.id, false)}>
              close
            </button>
          </li>
        ))}
        {current.length === 0 && <li>none</li>}
      </ul>

      <h2>suggested</h2>
      <p>minted treasury stock on obscurity that is not a sandbox yet.</p>
      <ul>
        {suggest.map((p) => (
          <li key={p.id}>
            <a href={`/parcels/${p.id}`}>{p.name || p.address || p.id}</a>{' '}
            <button disabled={busy === p.id} onClick={() => setSandbox(p.id, true)}>
              open
            </button>
          </li>
        ))}
        {suggest.length === 0 && <li>none</li>}
      </ul>
    </div>
  )
}
