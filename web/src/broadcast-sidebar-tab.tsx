import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { isMobileMedia } from '../../common/helpers/detector'
import { broadcastShowboxUuid, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { getCoords } from './helpers/coords-nav'

export function BroadcastSidebarTab() {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    broadcastShowboxUuid.value
    uiPane.value
    sidebarClosed.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  if (!getCoords() || isMobileMedia() || !broadcastShowboxUuid.value) return null
  // the panel is already on screen, no need for the reopen tab
  if (uiPane.value === 'broadcast' && !sidebarClosed.value) return null

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
      live
    </button>
  )
}
