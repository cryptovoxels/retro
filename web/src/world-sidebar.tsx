import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, nearestEditableParcel, selectNearestEditableParcel, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  children: ComponentChildren
}

// panes you open on purpose and leave up while walking around get a close X;
// contextual build/edit panes dismiss when you click back into the world.
// broadcast is excluded: it has its own show/hide tab and would get trapped here.
const PERSISTENT = new Set(['info', 'explorer', 'settings', 'help'])

export function WorldSidebar({ coords, children }: Props) {
  const [, bump] = useState(0)
  const prevKey = useRef('')
  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    nearestEditableParcel.value

    const parcel = selectNearestEditableParcel()
    const key = uiPane.value || (parcel && isAuthoring(parcel.id) ? `auth:${parcel.id}` : '')
    // new content (build/edit/broadcast/authoring) wants the sidebar: open it
    if (key && key !== prevKey.current) sidebarClosed.value = false
    prevKey.current = key

    document.body.classList.toggle('sidebar-closed', sidebarClosed.value)
    bump((n) => n + 1)
  })

  // when closed we keep the aside mounted (CSS hides it + collapses the grid) so the
  // children Router and any open pane keep their state; only the canvas resizes.
  if (!coords) return <>{children}</>

  const close = (
    <button class="sidebar-close" title="close" onClick={() => (sidebarClosed.value = true)}>
      x
    </button>
  )

  if (uiPane.value === 'broadcast') {
    return (
      <aside class="-broadcast-open">
        <InWorldPane id="broadcast" />
      </aside>
    )
  }

  const parcel = selectNearestEditableParcel()
  if (parcel && isAuthoring(parcel.id)) {
    return (
      <aside>
        <Authoring parcel={parcel} />
      </aside>
    )
  }

  const pane = uiPane.value
  const showClose = !pane || PERSISTENT.has(pane)
  return (
    <aside>
      {showClose && close}
      {pane ? <InWorldPane id={pane} /> : children}
    </aside>
  )
}
