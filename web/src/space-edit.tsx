import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Login } from './auth/login'
import SelectUser from './components/select-user'
import { app } from './state'

interface Props {
  path?: string
  id?: string
}

export default function SpaceEdit(props: Props) {
  if (!app.signedIn) return <Login reason="edit this space" />

  const [space, setSpace] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/spaces/${props.id}.json`)
      .then((r) => r.json())
      .then((d) => setSpace(d.space))
  }, [props.id])

  function set(key: string, value: any) {
    setSpace((s: any) => ({ ...s, [key]: value }))
  }

  function setSettings(key: string, value: any) {
    setSpace((s: any) => ({ ...s, settings: { ...s.settings, [key]: value } }))
  }

  function addCollab(wallet: string) {
    const collab: string[] = [...(space.settings?.collab || [])]
    const w = wallet.toLowerCase()
    if (!collab.includes(w)) collab.push(w)
    setSettings('collab', collab)
  }

  function dropCollab(wallet: string) {
    const collab = ((space.settings?.collab || []) as string[]).filter((w) => w.toLowerCase() !== wallet.toLowerCase())
    setSettings('collab', collab)
  }

  async function submit(e: Event) {
    e.preventDefault()
    setSaving(true)
    await fetch(`/spaces/${props.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: space.name,
        description: space.description,
        sandbox: !!space.settings?.sandbox,
        hosted_scripts: !!space.settings?.hosted_scripts,
        script_host_url: space.settings?.script_host_url,
        unlisted: !!space.unlisted,
        collab: space.settings?.collab || [],
        ...(hasSlug ? { slug: space.slug } : {}),
      }),
    })
    setSaving(false)
    route(`/spaces/${props.id}`)
  }

  if (!space) return <p>Loading...</p>

  // slug is only editable if it was already set and isn't a UUID
  const hasSlug = space.slug && space.slug.length !== 36
  const paid = !!(space.paid || (space.until && new Date(space.until) > new Date()))

  return (
    <section class="columns">
      <article>
        <hgroup>
          <h1>
            <a href={`/spaces/${props.id}`}>{space.name || space.id}</a> / edit
          </h1>
        </hgroup>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={space.name || ''} onInput={(e: any) => set('name', e.target.value)} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea rows={5} value={space.description || ''} onInput={(e: any) => set('description', e.target.value)} />
          </div>
          <div class="f">
            <label>
              <input type="checkbox" checked={!!space.unlisted} onChange={(e: any) => set('unlisted', e.target.checked)} />
              Unlisted
            </label>
          </div>
          <div class="f">
            <label>
              <input type="checkbox" checked={!!space.settings?.sandbox} onChange={(e: any) => setSettings('sandbox', e.target.checked)} />
              Sandbox (publicly editable)
            </label>
          </div>
          {hasSlug && (
            <div class="f">
              <label>Slug</label>
              <input type="text" value={space.slug || ''} onInput={(e: any) => set('slug', e.target.value)} />
            </div>
          )}
          {paid && (
            <>
              <h3>collaborators</h3>
              <SelectUser onSelect={addCollab} />
              <ul>
                {((space.settings?.collab || []) as string[]).map((w) => (
                  <li key={w}>
                    <a href={`/u/${w}`}>{w.substring(0, 10)}...</a>{' '}
                    <button type="button" onClick={() => dropCollab(w)}>
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </article>
      <aside />
    </section>
  )
}
