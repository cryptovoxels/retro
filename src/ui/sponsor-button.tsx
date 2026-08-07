import { app } from '../../web/src/state'
import { sponsorBy, unpaid } from '../space-paid'

export default function SponsorButton() {
  if (!window.config?.isSpace) return null

  if (!unpaid()) {
    const by = sponsorBy()
    if (!by) return null
    return <div class="sponsor-by">sponsored by {by}</div>
  }

  async function go() {
    if (!app.signedIn) {
      location.href = '/login'
      return
    }
    const id = window.config.spaceId
    if (!id) return
    try {
      const r = await fetch(`/api/spaces/${id}/sponsor`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const d = await r.json()
      if (d.url) location.href = d.url
    } catch {
      return
    }
  }

  return (
    <button type="button" class="womp-button" title="sponsor color" onClick={go}>
      sponsor color $5
    </button>
  )
}
