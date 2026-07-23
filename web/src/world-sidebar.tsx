import type { ComponentChildren, VNode } from 'preact'
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
    if (key && key !== prevKey.current) sidebarClosed.value = false
    prevKey.current = key

    bump((n) => n + 1)
  })

  // pages always render; in-world panes sit beside them when open
  if (!coords) return <>{children}</>

  const closed = sidebarClosed.value ? '-closed' : undefined
  const close = (
    <button class="sidebar-close" title="close" onClick={() => (sidebarClosed.value = true)}>
      x
    </button>
  )

  let pane: VNode | null = null

  if (uiPane.value === 'broadcast') {
    pane = (
      <aside class={['-broadcast-open', closed].filter(Boolean).join(' ')}>
        {close}
        <InWorldPane id="broadcast" />
      </aside>
    )
  } else {
    const parcel = selectNearestEditableParcel()
    if (parcel && isAuthoring(parcel.id)) {
      pane = (
        <aside class={closed}>
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      const showClose = isPersistentPane(uiPane.value)
      pane = (
        <aside class={closed}>
          {showClose && close}
          <InWorldPane id={uiPane.value} />
        </aside>
      )
    }
  }

  return (
    <>
      {children}
      {pane}
    </>
  )
}
