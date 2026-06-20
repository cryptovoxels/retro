// Client helpers for anonymous showbox guest links.

import Cookies from 'js-cookie'
import { decodeJwt } from 'jose'

export function clearSyntheticGuestClientName(setName: (name: string | undefined) => void) {
  setName(undefined)
  try {
    const app = (window as any).app
    if (app?.avatarRef && typeof app.avatarRef === 'object') {
      app.avatarRef = { ...app.avatarRef, name: '' }
    }
    const av = (window as any).persona?.avatar as { _description?: { name?: string } } | undefined
    if (av?._description) av._description.name = ''
  } catch {}
}

export function consumeGuestFreshFromUrl(setName: (name: string | undefined) => void): boolean {
  try {
    const u = new URL(window.location.href)
    if (u.searchParams.get('guest_fresh') !== '1') return false
    u.searchParams.delete('guest_fresh')
    const qs = u.searchParams.toString()
    window.history.replaceState(window.history.state, '', u.pathname + (qs ? `?${qs}` : '') + u.hash)
    clearSyntheticGuestClientName(setName)
    return true
  } catch {
    return false
  }
}

// Re-issue anon guest jwt before the 1h cookie expires mid-stream
export async function maybeRefreshGuestJwt() {
  try {
    const app = (window as any).app
    const key = app?.state?.key || Cookies.get('jwt')
    if (!key) return
    const payload = decodeJwt(key) as { exp?: number; guest_pass?: string }
    if (!payload.guest_pass) return
    const exp = payload.exp ? payload.exp * 1000 : 0
    if (!exp || exp - Date.now() > 10 * 60 * 1000) return
    const r = await fetch(`/api/guest/${encodeURIComponent(payload.guest_pass)}/refresh`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return
    const data = await r.json()
    if (data.jwt && app?.state) app.state.key = data.jwt
  } catch {}
}
