import { useSignalEffect } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { isMobileMedia } from '../../common/helpers/detector'
import { broadcastLiveStartedAt, broadcastShowboxUuid, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { getCoords } from './helpers/coords-nav'

export function BroadcastSidebarTab() {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    broadcastShowboxUuid.value
    broadcastLiveStartedAt.value
    uiPane.value
    sidebarClosed.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  // count up the live timer while we're streaming
  useEffect(() => {
    if (!broadcastLiveStartedAt.value) return
    const t = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [broadcastLiveStartedAt.value])

  if (!getCoords() || isMobileMedia() || !broadcastShowboxUuid.value) return null
  // the panel is already on screen, no need for the reopen tab
  if (uiPane.value === 'broadcast' && !sidebarClosed.value) return null

  const started = broadcastLiveStartedAt.value
  const s = started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0
  const elapsed = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <button
      type="button"
      class="broadcast-sidebar-tab"
      title="open broadcast controls"
      onClick={() => {
        uiPane.value = 'broadcast'
        sidebarClosed.value = false
        uiAsideTick.value++
      }}
    >
      <span class="broadcast-sidebar-tab-dot">{'\u25CF'}</span>
      <span>live</span>
      {started && <span class="broadcast-sidebar-tab-time">{elapsed}</span>}
    </button>
  )
}
