import { useEffect, useState } from 'preact/hooks'
import cachedFetch, { invalidateUrl } from '../helpers/cached-fetch'

type Proposal = { id: number; proposer: string; name: string; parcels: any[]; status: string; created_at: string }

const url = '/api/admin/island-proposals'

export default function Proposals() {
  const [rows, setRows] = useState<Proposal[]>([])
  const [busy, setBusy] = useState<number | null>(null)

  async function load() {
    try {
      const r = await cachedFetch(url)
      const d = await r.json()
      setRows(d.proposals || [])
    } catch {}
  }

  useEffect(() => {
    load()
  }, [])

  async function act(id: number, action: 'accept' | 'reject') {
    setBusy(id)
    try {
      await fetch(`/api/admin/island-proposals/${id}/${action}`, { method: 'POST' })
      invalidateUrl(url)
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) {
    return (
      <div class="admin-section">
        <p>no pending proposals.</p>
      </div>
    )
  }

  return (
    <div class="admin-section">
      <p>accepting drops the island + its parcels into the db in sandbox mode, ready to mint.</p>
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>proposer</th>
            <th>parcels</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.name}</td>
              <td>{p.proposer.slice(0, 8)}...</td>
              <td>{(p.parcels || []).length}</td>
              <td>
                <button disabled={busy === p.id} onClick={() => act(p.id, 'accept')}>
                  accept
                </button>
                <button disabled={busy === p.id} onClick={() => act(p.id, 'reject')}>
                  reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
