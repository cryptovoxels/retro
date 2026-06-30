import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { isMobileMedia } from '../../common/helpers/detector'
import { broadcastShowboxUuid, uiAsideTick, uiPane } from '../../src/store'
import { getCoords } from './helpers/coords-nav'

type Props = {
  fullscreen: boolean
}

export function BroadcastSidebarTab({ fullscreen }: Props) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    broadcastShowboxUuid.value
    uiPane.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  if (!fullscreen || !getCoords() || isMobileMedia()) return null
  if (!broadcastShowboxUuid.value || uiPane.value === 'broadcast') return null

  return (
    <button
      type="button"
      class="broadcast-sidebar-tab"
      title="open broadcast controls"
      onClick={() => {
        uiPane.value = 'broadcast'
        uiAsideTick.value++
      }}
    >
      live
    </button>
  )
}
