import { signal } from '@preact/signals'
import cachedFetch, { invalidateUrl } from '../helpers/cached-fetch'
import { app, AppEvent } from '../state'

export const ME_URL = '/api/account/me'

export type Identity = { wallet: string; name: string | null; email: string | null }

export type Me = {
  wallet: string
  account: string | null
  email: string | null
  identities: Identity[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isEmailAccount = (wallet: string) => UUID.test(wallet)

export function identityLabel(id: Identity) {
  if (id.name) return id.name
  if (isEmailAccount(id.wallet)) return id.email ?? 'email account'
  return id.wallet.slice(0, 6) + '...' + id.wallet.slice(-4)
}

/** The signed-in user's linked identities, shared by the header switcher and the profile page. */
export const me = signal<Me | null>(null)

let loadedFor: string | null = null

export async function loadMe(force = false): Promise<Me | null> {
  const wallet = app.state.wallet
  if (!wallet) {
    loadedFor = null
    me.value = null
    return null
  }
  if (!force && loadedFor === wallet) return me.value
  loadedFor = wallet
  if (force) await invalidateUrl(ME_URL)
  try {
    const r = await cachedFetch(ME_URL)
    const j = await r.json()
    if (loadedFor === wallet) me.value = j.success ? (j as Me) : null
  } catch {
    if (loadedFor === wallet) me.value = null
  }
  return me.value
}

app.on(AppEvent.Change, () => {
  if (app.state.wallet !== loadedFor) void loadMe()
})

/** Switch the session to a linked identity. The world reconnects on the Login event. */
export async function appoint(wallet: string): Promise<boolean> {
  const f = await fetch('/api/delegations/appoint', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
  const r = await f.json().catch(() => null)
  if (!f.ok || !r?.success) return false
  await invalidateUrl(ME_URL)
  await invalidateUrl(`/api/avatars/${wallet}*`)
  app.onToken(r.token, r.name ?? null, false)
  return true
}
