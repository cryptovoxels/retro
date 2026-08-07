import { useState } from 'preact/hooks'
import { app } from '../../web/src/state'
import { sponsorBy, unpaid } from '../space-paid'

export default function SponsorButton() {
  if (!window.config?.isSpace) return null

  if (!unpaid()) {
    const { by, who, say } = sponsorBy()
    if (!by) return null
    const href = who ? `/u/${who}` : `/avatar/${encodeURIComponent(by)}`
    return (
      <div class="sponsor-by">
        <a href={href}>Sponsored by {by}</a>
        {say ? <div>{say}</div> : null}
      </div>
    )
  }

  return <SponsorForm />
}

function SponsorForm() {
  const [open, setOpen] = useState(false)
  const [say, setSay] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(e: Event) {
    e.preventDefault()
    if (!app.signedIn) {
      location.href = '/login'
      return
    }
    const id = window.config.spaceId
    if (!id || busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/spaces/${id}/sponsor`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ say: say.slice(0, 50) }),
      })
      const d = await r.json()
      if (d.url) location.href = d.url
    } catch {
      /* ignore */
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <button type="button" class="womp-button" title="sponsor color" onClick={() => setOpen(true)}>
        sponsor color $5
      </button>
    )
  }

  return (
    <form class="sponsor-form" onSubmit={go}>
      <div class="f">
        <label>your line (50)</label>
        <input type="text" maxlength={50} value={say} onInput={(e: any) => setSay(e.target.value.slice(0, 50))} placeholder="why this space rules" autofocus />
      </div>
      <button type="submit" disabled={busy}>
        {busy ? '...' : 'sponsor color $5'}
      </button>
    </form>
  )
}
