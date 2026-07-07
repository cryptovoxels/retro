import { useEffect, useRef } from 'preact/hooks'
import { broadcastDockEl } from '../../src/store'

// Mount point for the imperative showbox broadcast dock when ?coords= split layout is active.
export function ShowboxBroadcastPane() {
  const ref = useRef<HTMLDivElement>(null)
  // the dock outlives this mount (preact tears the pane down whenever uiPane leaves 'broadcast') -
  // re-adopt the panel on every remount, or reopening via the live tab shows an empty box mid-show
  useEffect(() => {
    const el = broadcastDockEl.el
    const mount = ref.current
    if (!el || !mount || el.parentElement === mount) return
    mount.appendChild(el)
    // moving a playing <video> through the DOM pauses it in some browsers - nudge the previews back
    el.querySelectorAll('video').forEach((v) => v.play().catch(() => {}))
  })
  return <div id="showbox-broadcast-mount" class="showbox-broadcast-mount" ref={ref} />
}
