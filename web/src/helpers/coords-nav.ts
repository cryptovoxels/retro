export function getCoords() {
  if (typeof location === 'undefined') return ''
  return new URLSearchParams(location.search).get('coords') || ''
}

export function isPlayPath(path?: string) {
  const p = (path || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  return p === '/play'
}

export function isSpacePlayPath(path?: string) {
  const p = (path || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  return /^\/spaces\/[^/]+\/play$/.test(p)
}

export function isSpacePath(path?: string) {
  return !!getSpaceIdFromPath(path)
}

export function getSpaceIdFromPath(path?: string): string | null {
  const p = (path || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  const m = p.match(/^\/spaces\/([^/]+)(?:\/play)?$/)
  return m ? m[1] : null
}

export function isWorldRoute(path?: string) {
  const p = (path || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  return !p.startsWith('/spaces/')
}

export function notifyUrlChange() {
  window.dispatchEvent(new Event('urlchange'))
}

export function notifyParcelChange() {
  window.dispatchEvent(new Event('parcelchange'))
}

export function getParcelIdFromPath(path?: string): number | null {
  const p = (path || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0]
  const m = p.match(/^\/parcels\/(\d+)$/)
  if (!m) return null
  const id = parseInt(m[1], 10)
  return Number.isFinite(id) ? id : null
}

export function syncParcelUrl(id: number) {
  if (typeof location === 'undefined') return
  if (!/^\/parcels\/\d+$/.test(location.pathname.split('?')[0])) return
  if (getParcelIdFromPath() === id) return
  history.replaceState(null, '', `/parcels/${id}`)
  notifyParcelChange()
}

export function naviportHere(urlOrCoords: string) {
  let c = urlOrCoords
  if (urlOrCoords.includes('coords=')) {
    try {
      c = new URL(urlOrCoords, location.origin).searchParams.get('coords') || ''
    } catch {
      return
    }
  }
  if (!c) return
  try {
    window.persona?.naviport(c)
  } catch (e) {
    console.error(e)
  }
}
