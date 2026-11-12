import { avatarName, type AvatarRef } from './messages/avatar-ref'
import type { IslandRecord } from './messages/api-islands'
import type { CachedParcelsMessage } from './messages/api-parcels'

export function ethTrunc(wallet: string | null | undefined) {
  if (!wallet) {
    return ''
  }

  return wallet.slice(0, 5) + '..' + wallet.slice(-3)
}

let islandRequest: Promise<{ islands: IslandRecord[] }> | undefined

export function fetchIslands() {
  return (islandRequest ??= fetch('/api/world/islands.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Island list: ${response.status}`)
      return response.json()
    })
    .finally(() => {
      islandRequest = undefined
    }))
}

let parcelRequest: Promise<CachedParcelsMessage> | undefined

export function parcelIndex(refresh = false): Promise<CachedParcelsMessage> {
  if (refresh) parcelRequest = undefined
  return (parcelRequest ??= (async () => {
    let attempts = 0
    for (;;) {
      try {
        const response = await fetch(`${process.env.ASSET_PATH || ''}/api/parcels/cached.json?world`, {
          cache: attempts || refresh ? 'reload' : 'default',
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error(`Parcel index: ${response.status}`)
        const data = await response.json()
        if (!data.parcels) throw new Error('Parcel index unavailable')
        return data
      } catch {
        // The world cannot start without this index. Keep the cube up and recover.
        await new Promise((resolve) => setTimeout(resolve, Math.min(++attempts, 5) * 1000))
      }
    }
  })())
}

// Chat IDs are UUIDv7, including history replayed over the socket.
export function chatTime(id?: string) {
  return id?.[14] === '7' ? parseInt(id.replace(/-/g, '').slice(0, 12), 16) || 0 : 0
}

export function chatName(ref?: AvatarRef, uuid?: string) {
  const name = avatarName(ref)
  const raw = name.replace(/^guest:/, '')
  if (name.startsWith('guest:') || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw)) return `guest ${raw.slice(-6)}`
  if (name && name !== 'anon' && name !== '...') return name
  return uuid ? `guest ${uuid.slice(-6)}` : 'guest'
}

export function mergeChat<T extends { id?: string }>(history: T[], live: T[]): T[] {
  const ids = new Set(live.map((m) => m.id).filter(Boolean))
  return [...history.filter((m) => !m.id || !ids.has(m.id)), ...live].slice(-1000)
}
