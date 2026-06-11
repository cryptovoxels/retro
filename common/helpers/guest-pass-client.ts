// Client helpers for anonymous showbox guest links.

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
