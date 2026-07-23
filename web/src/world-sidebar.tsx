import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, isPersistentPane, nearestEditableParcel, selectNearestEditableParcel, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  path?: string
  children: ComponentChildren
}

export function WorldSidebar({ coords, path, children }: Props) {
  const [, bump] = useState(0)
  const prevKey = useRef('')

  // landing on (or navigating to) a womp should reveal the sidebar so you can read it
  useEffect(() => {
    if (path?.startsWith('/womps/')) sidebarClosed.value = false
    if (path?.startsWith('/chat')) sidebarClosed.value = false
  }, [path])

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

    bump((n) => n + 1)
  })

  // when closed we keep the aside mounted so the children Router and any open pane keep their state
  if (!coords) return <>{children}</>

  const closed = sidebarClosed.value ? '-closed' : undefined

  const close = (
    <button class="sidebar-close" title="close" onClick={() => (sidebarClosed.value = true)}>
      x
    </button>
  )

  if (uiPane.value === 'broadcast') {
    return (
      <aside class={['-broadcast-open', closed].filter(Boolean).join(' ')}>
        {close}
        <InWorldPane id="broadcast" />
      </aside>
    )
  }

  const parcel = selectNearestEditableParcel()
  if (parcel && isAuthoring(parcel.id)) {
    return (
      <aside class={closed}>
        <Authoring parcel={parcel} />
      </aside>
    )
  }

  const pane = uiPane.value
  const showClose = !pane || isPersistentPane(pane)
  return (
    <aside class={closed}>
      {showClose && close}
      {pane ? <InWorldPane id={pane} /> : children}
    </aside>
  )
}
