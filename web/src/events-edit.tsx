import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import ParcelField from './components/parcel-field'
import DateField from './components/date-field'
import { Login } from './auth/login'
import { invalidateUrl } from './helpers/cached-fetch'
import { app } from './state'
import { fetchOptions } from './utils'

interface Props {
  path?: string
  id?: string
}

export default function EventsEdit(props: Props) {
  if (!app.signedIn) return <Login reason="edit this event" />

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [location, setLocation] = useState<{ parcel_id?: number; location_url?: string }>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/events/${props.id}.json`)
      .then((r) => r.json())
      .then(({ event }) => {
        if (!event) return
        setName(event.name || '')
        setDescription(event.description || '')
        if (event.starts_at) {
          const d = new Date(event.starts_at)
          setStartsAt(d.toISOString().slice(0, 16))
        }
        if (event.starts_at && event.expires_at) {
          const ms = new Date(event.expires_at).getTime() - new Date(event.starts_at).getTime()
          setDuration(Math.round(ms / 60000))
        }
        if (event.parcel_id) setLocation({ parcel_id: event.parcel_id })
      })
  }, [props.id])

  async function submit(e: Event) {
    e.preventDefault()
    if (!name.trim() || !startsAt) return
    setSaving(true)
    setError(null)

    const start = new Date(startsAt)
    const expires = new Date(start.getTime() + duration * 60000)

    const r = await fetch(`/api/events/update`, {
      ...fetchOptions(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: props.id,
        name: name.trim(),
        description,
        starts_at: start.toISOString(),
        expires_at: expires.toISOString(),
        parcel_id: location.parcel_id,
      }),
    }).then((r) => r.json())

    setSaving(false)
    if (!r.success) {
      setError(r.message || 'Error')
      return
    }
    await invalidateUrl(`/api/events/${props.id}.json`, true)
    route(`/events/${props.id}`)
  }

  async function onDelete() {
    if (!confirm('Delete this event?')) return
    await fetch(`/api/events/${props.id}`, { ...fetchOptions(), method: 'DELETE' })
    route('/events')
  }

  return (
    <section class="columns">
      <article>
        <hgroup>
          <h1>Edit Event</h1>
        </hgroup>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={name} onInput={(e: any) => setName(e.target.value)} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea value={description} onInput={(e: any) => setDescription(e.target.value)} rows={5} />
          </div>
          <div class="f">
            <label>Start</label>
            <DateField value={startsAt} onChange={setStartsAt} />
          </div>
          <div class="f">
            <label>Duration (minutes)</label>
            <input type="number" value={duration} min={1} onInput={(e: any) => setDuration(parseInt(e.target.value, 10))} />
          </div>
          <div class="f">
            <label>Location</label>
            <ParcelField value={location} onChange={setLocation} />
            <small>Search for a voxels parcel, or paste a link from oncyber, substrata, somniumspace, hyperfy, resonite, overte, decentraland</small>
          </div>
          {error && <p>{error}</p>}

          <div class="f">
            <button type="submit" disabled={saving || !name.trim() || !startsAt}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            or
            <button onClick={onDelete}>Delete</button>
          </div>
        </form>
      </article>
    </section>
  )
}
