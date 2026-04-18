import { useEffect, useState } from 'preact/hooks'
import { congaFollowUiRev } from '../connector'

const CONGA_JOIN_HINT_POLL_MS = 250

/** Bottom-center status while in a conga line (same idea as feature-mode-overlay for build tools). */
export function CongaStatusOverlay() {
  congaFollowUiRev.value
  const c = window.connector
  if (!c?.inConga) return null
  const target = c.controls?.congaTarget
  if (c.congaLeaderStartedBannerVisible()) {
    return (
      <div class="conga-status-overlay conga-status-overlay--started">
        <div class="conga-status-overlay__badge">Conga</div>
        <div class="conga-status-overlay__main">You started a conga line</div>
        <div class="conga-status-overlay__hint">
          Type <span class="conga-status-overlay__kbd">/conga</span> again to stop
        </div>
      </div>
    )
  }
  const line = target ? `Following ${target.name}` : 'Leading the line'
  const hint = target ? 'WASD or Escape to leave' : 'Type /conga again to stop'
  return (
    <div class="conga-status-overlay">
      <div class="conga-status-overlay__badge">Conga</div>
      <div class="conga-status-overlay__main">{line}</div>
      <div class="conga-status-overlay__hint">{hint}</div>
    </div>
  )
}

/** When not in a line but someone in range is, nudge anonymous `/conga` join (same radius as connector). */
export function CongaJoinHintOverlay() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), CONGA_JOIN_HINT_POLL_MS)
    return () => window.clearInterval(id)
  }, [])
  congaFollowUiRev.value
  const c = window.connector
  if (!c?.inConga) {
    if (!c.allowCongaJoinHint()) return null
    const host = c?.nearestInCongaAvatarInJoinRange() ?? null
    if (!host) return null
    return (
      <div class="conga-status-overlay conga-status-overlay--join-hint">
        <div class="conga-status-overlay__badge">Conga nearby</div>
        <div class="conga-status-overlay__main">
          Type <span class="conga-status-overlay__kbd">/conga</span> to join {host.name}
        </div>
      </div>
    )
  }
  return null
}
