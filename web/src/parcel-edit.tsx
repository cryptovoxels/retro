import { useEffect, useRef, useState } from 'preact/hooks'
import * as strftime from 'strftime'
import { blocks } from '../../common/content/blocks'
import { Login } from './auth/login'
import SelectUser from './components/select-user'
import cachedFetch, { invalidateUrl } from './helpers/cached-fetch'
import { isSplit, routeWithCoords, withCoords } from './helpers/coords-nav'
import { app } from './state'

type ParcelUser = { wallet: string; role: string }

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
  const fileRef = useRef<HTMLInputElement>(null)

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
    const r = await fetch(`/api/parcels/${props.id}/history.json?limit=50&page=0&asc=false`, { credentials: 'include' })
    const d = await r.json()
    setVersions(d.versions ?? [])
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
        sandbox: !!parcel.settings?.sandbox,
        parcel_users: parcel.parcel_users ?? [],
      }),
    })
    setSaving(false)
    await invalidateUrl(`/api/parcels/${props.id}.json`, true)
    routeWithCoords(`/parcels/${props.id}`)
  }

  function back(e?: Event) {
    e?.preventDefault()
    routeWithCoords(`/parcels/${props.id}`)
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
    if (users.find((u) => u.wallet.toLowerCase() === wallet.toLowerCase())) return
    set('parcel_users', [...users, { wallet, role: 'contributor' }])
  }

  function removeCollaborator(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).filter((u: ParcelUser) => u.wallet !== wallet),
    )
  }

  function toggleRole(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).map((u: ParcelUser) => (u.wallet === wallet ? { ...u, role: u.role === 'owner' ? 'contributor' : 'owner' } : u)),
    )
  }

  async function takeSnapshot() {
    await fetch(`/api/parcels/snapshot`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_id: parcel.id }),
    })
    loadVersions()
  }

  async function revert(v: Version) {
    if (!confirm(`Revert to version #${v.id} from ${strftime('%B %-d, %Y at %-I%P', new Date(v.updated_at))}?`)) return
    await fetch(`/api/parcels/${v.parcel_id}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ parcel_version_id: v.id }),
    })
    loadVersions()
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

  async function importJson(e: Event) {
    const input = e.target as HTMLInputElement
    if (!input.files?.[0]) return
    const text = await input.files[0].text()
    let content
    try {
      content = JSON.parse(text).content ?? JSON.parse(text)
    } catch {
      alert('Invalid JSON')
      return
    }
    await fetch(`/grid/parcels/${parcel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content }),
    })
    if (fileRef.current) fileRef.current.value = ''
    loadVersions()
  }

  if (!parcel) return <p>Loading...</p>

  const wallet = app.state.wallet?.toLowerCase()
  const isOwner = app.isOwner(parcel.owner)
  const isCollaborator = !!wallet && (parcel.parcel_users ?? []).some((u: ParcelUser) => u.wallet.toLowerCase() === wallet)
  const canEdit = isOwner || isCollaborator

  const title = (
    <hgroup>
      <h1>
        <a href={withCoords(`/parcels/${props.id}`)} onClick={back}>
          {parcel.name || parcel.address}
        </a>{' '}
        / edit
      </h1>
    </hgroup>
  )

  const form = (
    <form onSubmit={submit}>
      <h3>basics</h3>
      <div class="f">
        <label>Name</label>
        <input type="text" value={parcel.name || ''} onInput={(e: any) => set('name', e.target.value)} />
      </div>
      <div class="f">
        <label>Description</label>
        <textarea rows={5} value={parcel.description || ''} onInput={(e: any) => set('description', e.target.value)} />
      </div>

      <h3>settings</h3>
      <div class="f">
        <label>
          <input type="checkbox" checked={!!parcel.settings?.sandbox} onChange={(e: any) => setSettings('sandbox', e.target.checked)} /> Sandbox (publicly editable)
        </label>
      </div>

      {isOwner && (
        <>
          <h3>collaborators</h3>
          <SelectUser onSelect={addCollaborator} />
          {(parcel.parcel_users ?? []).length > 0 && (
            <ul>
              {(parcel.parcel_users as ParcelUser[]).map((u) => (
                <li key={u.wallet}>
                  <a href={`/u/${u.wallet}`}>{u.wallet.substring(0, 10)}...</a>{' '}
                  <button type="button" onClick={() => toggleRole(u.wallet)}>
                    {u.role}
                  </button>{' '}
                  <button type="button" onClick={() => removeCollaborator(u.wallet)}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </button>
    </form>
  )

  const history = (
    <>
      <h3>edit history</h3>
      <div class="f">
        <button type="button" onClick={takeSnapshot}>
          Take snapshot
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={importJson} />
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: '10%' }} scope="col">
              Type
            </th>
            <th>Creation date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>{v.is_snapshot && <small>snapshot</small>}</td>
              <td>
                <a
                  href="#"
                  onClick={(e: Event) => {
                    e.preventDefault()
                    revert(v)
                  }}
                >
                  {strftime('%B %-d, %Y at %-I%P', new Date(v.updated_at))}
                </a>
              </td>
              <td>
                <a
                  href="#"
                  onClick={(e: Event) => {
                    e.preventDefault()
                    download(v)
                  }}
                >
                  download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )

  const quickBuild = (
    <>
      <h3>quick build</h3>
      <p>Replaces all content on the parcel.</p>
      <div class="f">
        <label>Material</label>
        <select onChange={(e: any) => setBuildMaterial(e.target.value)}>
          {blocks.map((b) => (
            <option key={b.value} value={b.value}>
              {b.name.replace(/.png/, '')}
            </option>
          ))}
        </select>
      </div>
      <ul>
        {['Empty', 'Park', 'Outline', 'ThreeTowers', 'House', 'Pyramid', 'Scaffold'].map((fn) => (
          <li key={fn}>
            <button type="button" disabled={building} onClick={() => build(fn)}>
              {fn}
            </button>
          </li>
        ))}
      </ul>
    </>
  )

  if (!canEdit) {
    if (isSplit()) {
      return (
        <>
          {title}
          <p>You don't have permission to edit this parcel.</p>
        </>
      )
    }

    return (
      <section class="columns">
        <article>
          {title}
          <p>You don't have permission to edit this parcel.</p>
        </article>
      </section>
    )
  }

  if (isSplit()) {
    return (
      <>
        {title}
        {form}
        {quickBuild}
        {history}
      </>
    )
  }

  return (
    <section class="columns">
      <article>
        {title}
        {form}
        {history}
      </article>
      <aside>{quickBuild}</aside>
    </section>
  )
}
