import { decodeJwt } from 'jose'
import type { Room } from 'livekit-client'

export const BROADCAST_RECONNECT_MAX = 5
export const BROADCAST_DISCONNECT_STRIKES = 2
export const BROADCAST_CAMERA_STRIKES = 3
export const BROADCAST_CAMERA_ENDED_DELAY_MS = 2000
export const BROADCAST_LIVE_GRACE_MS = 15000
export const BROADCAST_HEALTH_POLL_MS = 4000

export function publishedVideoTrack(room: Room | null): any {
  const lp = (room as any)?.localParticipant
  if (!lp) return null
  const pubs = lp.videoTrackPublications ?? lp.videoTracks
  if (!pubs?.values) return null
  for (const pub of pubs.values()) {
    if (pub?.isMuted) continue
    const t = pub?.track ?? pub?.videoTrack
    if (!t) continue
    const mst = t.mediaStreamTrack as MediaStreamTrack | undefined
    if (mst && mst.readyState === 'ended') continue
    return t
  }
  return null
}

export function livekitRoomState(room: Room | null): string {
  return (room as any)?.state ?? 'disconnected'
}

export function showboxPublisherIdentityKey(roomName: string) {
  return `showbox-pub-id-${roomName}`
}

export function saveShowboxPublisherIdentity(roomName: string, token: string) {
  try {
    const sub = (decodeJwt(token) as { sub?: string }).sub
    if (sub) sessionStorage.setItem(showboxPublisherIdentityKey(roomName), sub)
  } catch {}
}

export function showboxTokenUrlWithIdentity(baseUrl: string, roomName: string, reusePublisher: boolean) {
  if (!reusePublisher) return baseUrl
  try {
    const id = sessionStorage.getItem(showboxPublisherIdentityKey(roomName))
    if (!id) return baseUrl
    const sep = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${sep}identity=${encodeURIComponent(id)}`
  } catch {
    return baseUrl
  }
}

export async function fetchShowboxRoomToken(url: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { credentials: 'include' })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.token) return j as { token: string; canPublish?: boolean; error?: string }
      if (r.status >= 500 && i + 1 < 3) {
        await new Promise((res) => setTimeout(res, 400 * (i + 1)))
        continue
      }
      return j as { token?: string; canPublish?: boolean; error?: string } | null
    } catch {
      if (i + 1 < 3) await new Promise((res) => setTimeout(res, 400 * (i + 1)))
    }
  }
  return null
}

// LiveKit publication is the source of truth - cached local track refs go stale after flip/restartTrack.
export function broadcastVideoTrackLive(room: Room | null, liveVideoTrack: any): boolean {
  if (publishedVideoTrack(room)) return true
  const mst = liveVideoTrack?.mediaStreamTrack as MediaStreamTrack | undefined
  return !!(mst && mst.readyState !== 'ended')
}
