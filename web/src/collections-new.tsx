import { Login } from './auth/login'
import { useEffect, useState } from 'preact/hooks'
import { app } from './state'
import { fetchOptions } from './utils'

export default function CollectionsNew({ path }: { path?: string }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canCreate, setCanCreate] = useState<boolean | null>(null)

  useEffect(() => {
    if (!app.signedIn || !app.wallet) {
      setCanCreate(false)
      return
    }
    fetch(`/api/wallet/${app.wallet}/parcels.json`, fetchOptions())
      .then((r) => r.json())
      .then((d) => setCanCreate((d.parcels || []).length > 0))
      .catch(() => setCanCreate(false))
  }, [app.signedIn, app.wallet])

  if (!app.signedIn) return <Login reason="create a collection" />

  async function submit(e: Event) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    const r = await fetch('/api/collections', {
      ...fetchOptions(),
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description }),
    }).then((r) => r.json())
    if (!r.success) {
      setSubmitting(false)
      setError(r.message || 'Error')
      return
    }
    window.location.href = `/collections/${r.collection_id}`
  }

  if (canCreate === null) return <p>Loading...</p>

  if (!canCreate) {
    return (
      <section>
        <hgroup>
          <h1>New Collection</h1>
          <p>
            you need a minted parcel to create a collection. <a href="/parcels">see parcels</a>
          </p>
        </hgroup>
      </section>
    )
  }

  return (
    <section>
      <hgroup>
        <h1>New Collection</h1>
        <p>wearables and assets, together. deploy on polygon when you're ready.</p>
      </hgroup>

      <article>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={name} onInput={(e: any) => setName(e.target.value)} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea value={description} onInput={(e: any) => setDescription(e.target.value)} />
          </div>
          {error && <p>{error}</p>}
          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      </article>
    </section>
  )
}
