import { useEffect, useState } from 'preact/hooks'
import { blocks } from '../../common/content/blocks'
import { Login } from './auth/login'
import SelectUser from './components/select-user'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import { route } from 'preact-router'
import { app } from './state'
import { ParcelUser } from '../../common/helpers/parcel-helper'
import { AvatarLink } from './components/avatar-link'

type Version = {
  id: number
  parcel_id: number
  is_snapshot: boolean
  updated_at: string
  snapshot_name?: string
}

interface Props {
  path?: string
  id?: string
}

export default function ParcelEdit(props: Props) {
  if (!app.signedIn) return <Login reason="edit this parcel" />

  const [parcel, setParcel] = useState<any>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [saving, setSaving] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildMaterial, setBuildMaterial] = useState(blocks[0].value)
  const [historyMessage, setHistoryMessage] = useState('')
  const [historyBusy, setHistoryBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<number>()
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const r = await cachedFetch(`/api/parcels/${props.id}.json`, { cache: 'reload' })
      const { parcel } = await r.json()
      setParcel(parcel)
      loadVersions()
    }

    load()
  }, [props.id])

  async function loadVersions() {
    setHistoryLoading(true)
    try {
      const r = await fetch(`/api/parcels/${props.id}/history.json?limit=50&page=0&asc=false`, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error('Could not load parcel edit history.')
      setVersions(d.versions ?? [])
      setSelectedId(d.versions?.[0]?.id)
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Could not load parcel edit history.')
    } finally {
      setHistoryLoading(false)
    }
  }

  function set(key: string, value: any) {
    setParcel((p: any) => ({ ...p, [key]: value }))
  }

  function setSettings(key: string, value: any) {
    setParcel((p: any) => ({ ...p, settings: { ...p.settings, [key]: value } }))
  }

  async function submit(e: Event) {
    e.preventDefault()
    setSaving(true)
    await fetch(`/grid/parcels/${props.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: parcel.name,
        description: parcel.description,
        sandbox: !!parcel.sandbox,
        parcel_users: parcel.parcel_users ?? [],
      }),
    })
    setSaving(false)
    await invalidateUrl(`/api/parcels/${props.id}.json`, true)
    route(`/parcels/${props.id}`)
  }

  function back(e?: Event) {
    e?.preventDefault()
    route(`/parcels/${props.id}`)
  }

  async function build(fn: string) {
    if (!confirm(`Replace current build with "${fn}"? This will destroy existing content.`)) return
    setBuilding(true)
    await fetch(`/grid/parcels/${props.id}/build?function=${fn}&material=${buildMaterial}`, {
      method: 'POST',
      credentials: 'include',
    })
    setBuilding(false)
  }

  function addCollaborator(wallet: string) {
    if (!wallet) return
    const users: ParcelUser[] = parcel.parcel_users ?? []
    if (users.find((u) => u.owner.toLowerCase() === wallet.toLowerCase())) return
    set('parcel_users', [...users, { owner: wallet, role: 'contributor' }])
  }

  function removeCollaborator(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).filter((u: ParcelUser) => u.owner !== wallet),
    )
  }

  function toggleRole(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).map((u: ParcelUser) => (u.owner === wallet ? { ...u, role: u.role === 'owner' ? 'contributor' : 'owner' } : u)),
    )
  }

  async function saveVersion() {
    setHistoryBusy(true)
    setHistoryMessage('')
    try {
      const r = await fetch('/api/parcels/snapshot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_id: parcel.id }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error('Could not save this version.')
      setHistoryMessage('Current build saved to parcel edit history.')
      await loadVersions()
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Could not save this version.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function revert(v: Version) {
    if (!confirm(`Restore the build from ${new Date(v.updated_at).toLocaleString()}? This replaces the current build.`)) return
    setHistoryBusy(true)
    setHistoryMessage('')
    try {
      const r = await fetch(`/api/parcels/${v.parcel_id}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ parcel_version_id: v.id }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error('Could not restore this version.')
      await invalidateUrl(`/api/parcels/${props.id}.json`)
      setHistoryMessage('Build restored.')
      await loadVersions()
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : 'Could not restore this version.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function download(v: Version) {
    const r = await fetch(`/api/parcels/${v.parcel_id}/history/${v.id}.json`, { credentials: 'include' })
    const d = await r.json()
    const data = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(d.version))
    const a = document.createElement('a')
    a.href = data
    a.download = `${v.parcel_id}-${v.id}.json`
    a.click()
  }

  if (!parcel) return <p>Loading...</p>

  const wallet = app.state.wallet?.toLowerCase()
  const isOwner = app.isOwner(parcel.owner)
  const isCollaborator = !!wallet && (parcel.parcel_users ?? []).some((u: ParcelUser) => u.owner.toLowerCase() === wallet)
  const canEdit = isOwner || isCollaborator

  const title = (
    <hgroup>
      <h1>
        <a href={`/parcels/${props.id}`} onClick={back}>
          {parcel.name || parcel.address}
        </a>{' '}
        / edit
      </h1>
    </hgroup>
  )

  const form = (
    <form id="parcel-edit-form" onSubmit={submit}>
      <section class="inspector-section">
        <h2>parcel details</h2>
        <div class="f">
          <label>Name</label>
          <input type="text" value={parcel.name || ''} onInput={(e: any) => set('name', e.target.value)} />
        </div>
        <div class="f">
          <label>Description</label>
          <textarea rows={5} value={parcel.description || ''} onInput={(e: any) => set('description', e.target.value)} />
        </div>
      </section>
      <section class="inspector-section">
        <h2>build permissions</h2>
        <div class="f">
          <label>
            <input type="checkbox" checked={!!parcel.sandbox} onChange={(e: any) => set('sandbox', e.target.checked)} /> Allow anyone to build (sandbox)
          </label>
        </div>
      </section>
      {isOwner && (
        <section class="inspector-section">
          <h2>collaborators</h2>
          <SelectUser onSelect={addCollaborator} />
          {(parcel.parcel_users ?? []).length > 0 && (
            <ul>
              {(parcel.parcel_users as ParcelUser[]).map((u) => (
                <li key={u.owner}>
                  <AvatarLink avatar={u as any} />{' '}
                  <button type="button" onClick={() => toggleRole(u.owner)}>
                    {u.role}
                  </button>{' '}
                  <button type="button" onClick={() => removeCollaborator(u.owner)}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </form>
  )

  const selectedVersion = versions.find((v) => v.id === selectedId)

  const history = (
    <section class="inspector-section" aria-label="Parcel edit history">
      <h2>parcel edit history</h2>
      {isOwner && (
        <button type="button" disabled={historyBusy} onClick={saveVersion}>
          Save current version
        </button>
      )}
      {historyMessage && <p role="status">{historyMessage}</p>}
      {historyLoading ? <p>Loading edit history...</p> : versions.length === 0 && !historyMessage ? <p>No saved versions yet.</p> : null}
      <div style={{ maxHeight: '10rem', overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Saved</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>
                  <label>
                    <input type="radio" name="parcel-version" value={v.id} checked={selectedId === v.id} onChange={() => setSelectedId(v.id)} /> {v.id}
                  </label>
                </td>
                <td>
                  <time dateTime={v.updated_at}>{new Date(v.updated_at).toLocaleString()}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" disabled={!selectedVersion || historyBusy} onClick={() => selectedVersion && download(selectedVersion)}>
        Download
      </button>{' '}
      {isOwner && (
        <button type="button" disabled={!selectedVersion || historyBusy} onClick={() => selectedVersion && revert(selectedVersion)}>
          Restore
        </button>
      )}
      <p>
        <a href={`/parcels/${props.id}`}>Parcel download / upload</a> is on the parcel page.
      </p>
    </section>
  )

  if (!canEdit) {
    return (
      <section>
        <article>
          {title}
          <p>You don't have permission to edit this parcel.</p>
        </article>
      </section>
    )
  }

  return (
    <section>
      <article>
        {title}
        {form}
        {history}
        <button type="submit" form="parcel-edit-form" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </article>
    </section>
  )
}
