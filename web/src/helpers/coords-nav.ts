import { route } from 'preact-router'

export function getCoords() {
  if (typeof location === 'undefined') return ''
  return new URLSearchParams(location.search).get('coords') || ''
}

export function getPane() {
  if (typeof location === 'undefined') return ''
  return new URLSearchParams(location.search).get('pane') || ''
}

export function isSplit() {
  return !!getCoords()
}

export function withCoords(path: string) {
  const c = getCoords()
  if (!c) return path
  const u = new URL(path, location.origin)
  u.searchParams.set('coords', c)
  u.searchParams.delete('pane')
  return u.pathname + u.search
}

export function withPane(path: string, pane: string) {
  const u = new URL(path.startsWith('http') ? path : path, location.origin)
  if (!path.startsWith('http')) {
    const base = path.includes('?') ? path : path
    const parsed = new URL(base, location.origin)
    u.pathname = parsed.pathname
    parsed.searchParams.forEach((v, k) => u.searchParams.set(k, v))
  }
  const c = getCoords()
  if (c) u.searchParams.set('coords', c)
  if (pane) u.searchParams.set('pane', pane)
  else u.searchParams.delete('pane')
  return u.pathname + u.search
}

export function stripPane() {
  const u = new URL(location.href)
  u.searchParams.delete('pane')
  history.replaceState(null, '', u.pathname + u.search)
  window.dispatchEvent(new Event('urlchange'))
}

export function routeWithCoords(path: string) {
  route(withCoords(path))
}

export function routeWithPane(pane: string) {
  const u = new URL(location.href)
  if (pane) u.searchParams.set('pane', pane)
  else u.searchParams.delete('pane')
  route(u.pathname + u.search)
}

export function notifyUrlChange() {
  window.dispatchEvent(new Event('urlchange'))
}

export function notifyPaneChange() {
  window.dispatchEvent(new Event('panechange'))
}

export function notifyParcelChange() {
  window.dispatchEvent(new Event('parcelchange'))
}

export function getParcelId() {
  if (typeof location === 'undefined') return null
  const p = new URLSearchParams(location.search).get('parcel')
  if (!p) return null
  const id = parseInt(p, 10)
  return Number.isFinite(id) ? id : null
}

export function getParcelIdFromPath(): number | null {
  if (typeof location === 'undefined') return null
  const m = location.pathname.match(/^\/parcels\/(\d+)$/)
  if (!m) return null
  const id = parseInt(m[1], 10)
  return Number.isFinite(id) ? id : null
}

export function syncParcelUrl(id: number) {
  if (typeof location === 'undefined') return
  if (getParcelIdFromPath() === id) return
  const u = new URL(location.href)
  u.pathname = `/parcels/${id}`
  u.searchParams.delete('parcel')
  history.replaceState(null, '', u.pathname + u.search)
  notifyParcelChange()
}

export function naviportHere(urlOrCoords: string, parcelId?: number) {
  let c = urlOrCoords
  if (urlOrCoords.includes('coords=')) {
    try {
      c = new URL(urlOrCoords, location.origin).searchParams.get('coords') || ''
    } catch {
      return
    }
  }
  if (!c) return
  const u = new URL(location.href)
  u.searchParams.set('coords', c)
  if (parcelId) u.searchParams.set('parcel', String(parcelId))
  history.replaceState(null, '', u.pathname + u.search)
  notifyUrlChange()
}
