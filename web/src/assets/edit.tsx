import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { JsonEditor } from 'json-edit-react'
import { Login } from '../auth/login'
import { app } from '../state'

interface Props {
  path?: string
  id?: any
}

export default function EditAsset(props: Props) {
  if (!app.signedIn) return <Login reason="edit this asset" />

  const [asset, setAsset] = useState<any>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/assets/${props.id}`)
      .then((r) => r.json())
      .then((d) => setAsset(d.asset))
    fetch(`/api/assets/categories`)
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
  }, [props.id])

  async function submit(e: Event) {
    e.preventDefault()
    setSaving(true)
    const r = await fetch(`/api/assets/${props.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(asset),
    })
    setSaving(false)
    if (r.ok) route(`/assets/${props.id}`)
  }

  async function onDelete() {
    if (!confirm('Delete this asset?')) return
    await fetch(`/api/assets/${props.id}`, { method: 'DELETE', credentials: 'include' })
    route('/assets')
  }

  function set(key: string, value: any) {
    setAsset((a: any) => ({ ...a, [key]: value }))
  }

  if (!asset) return <p>Loading...</p>

  return (
    <section>
      <article>
        <hgroup>
          <h1>
            <a href={`/assets/${props.id}`}>{asset.name}</a> / edit
          </h1>
        </hgroup>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={asset.name} onInput={(e: any) => set('name', e.target.value)} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea value={asset.description} onInput={(e: any) => set('description', e.target.value)} rows={5} />
          </div>
          <div class="f">
            <label>Category</label>
            <select value={asset.category} onChange={(e: any) => set('category', e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div class="f">
            <label>Content</label>
            <JsonEditor data={asset.content} setData={(e: any) => set('content', e)} />
          </div>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </article>
      <aside>
        <button onClick={onDelete}>Delete</button>
      </aside>
    </section>
  )
}
