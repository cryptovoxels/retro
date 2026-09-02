import { Login } from './auth/login'
import { useState } from 'preact/hooks'
import ParcelField from './components/parcel-field'
import DateField from './components/date-field'
import { app } from './state'
import { fetchOptions } from './utils'

interface Props {
  path?: string
  parcel_id?: string
}

export default function EventsNew(props: Props) {
  if (!app.signedIn) return <Login reason="make an event" />
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [location, setLocation] = useState<{ parcel_id?: number; location_url?: string }>(() => (props.parcel_id ? { parcel_id: parseInt(props.parcel_id, 10) } : {}))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: Event) {
    e.preventDefault()
    if (!name.trim() || !startsAt) return
    setSubmitting(true)
    setError(null)

    const start = new Date(startsAt)
    const expires = new Date(start.getTime() + duration * 60000)

    const r = await fetch('/api/events/add', {
      ...fetchOptions(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description,
        starts_at: start.toISOString(),
        expires_at: expires.toISOString(),
        parcel_id: location.parcel_id,
        // todo: support location_url for external events once API supports it
        color: '#ffffff',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }).then((r) => r.json())

    if (!r.success) {
      setSubmitting(false)
      setError(r.message || 'Error')
      return
    }

    window.location.href = `/events/${r.parcel_event.id}`
  }

  const isValid = () => {
    return name.length > 2 && startsAt && duration > 0
  }

  const disabled = submitting || !isValid()
  return (
    <section>
      <hgroup>
        <h1>New Event</h1>
        <p>Create an event on your parcel</p>
      </hgroup>

      <article>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={name} onInput={(e: any) => setName(e.target.value)} />
          </div>
          <div class="f">
            <label>Location</label>
            <ParcelField value={location} onChange={setLocation} />
            <small>Voxels parcel, or link to substrata, somniumspace, hyperfy, resonite, decentraland</small>
          </div>
          <div class="f">
            <label>Description</label>
            <textarea value={description} onInput={(e: any) => setDescription(e.target.value)} />
          </div>
          <div class="f">
            <label>Start</label>
            <DateField value={startsAt} onChange={setStartsAt} />
          </div>
          <div class="f">
            <label>Length</label>
            <input type="number" value={duration} style={{ width: '4em' }} min={1} onInput={(e: any) => setDuration(parseInt(e.target.value, 10))} /> minutes
          </div>
          {error && <p>{error}</p>}
          <button type="submit" disabled={disabled}>
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      </article>
    </section>
  )
}
