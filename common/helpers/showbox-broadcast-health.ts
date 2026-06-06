import type { Room } from 'livekit-client'

export const BROADCAST_RECONNECT_MAX = 5
export const BROADCAST_DISCONNECT_STRIKES = 2
export const BROADCAST_LIVE_GRACE_MS = 15000
export const BROADCAST_HEALTH_POLL_MS = 4000

export function broadcastVideoTrackLive(room: Room | null, liveVideoTrack: any): boolean {
  const mst = liveVideoTrack?.mediaStreamTrack as MediaStreamTrack | undefined
  if (mst && mst.readyState !== 'ended') return true
  const lp = (room as any)?.localParticipant
  for (const pub of lp?.videoTrackPublications?.values() ?? []) {
    const t = (pub?.track?.mediaStreamTrack ?? pub?.videoTrack?.mediaStreamTrack) as MediaStreamTrack | undefined
    if (t && t.readyState !== 'ended') return true
  }
  return false
}
