import type { ComponentChildren, VNode } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, isPersistentPane, nearestEditableParcel, selectNearestEditableParcel, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { isFullClientPath } from './helpers/coords-nav'
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

  useEffect(() => {
    return () => document.body.classList.remove('sidebar-closed')
  }, [])

  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    nearestEditableParcel.value
    sidebarClosed.value

    const parcel = selectNearestEditableParcel()
    const key = uiPane.value || (parcel && isAuthoring(parcel.id) ? `auth:${parcel.id}` : '')
    if (key && key !== prevKey.current) sidebarClosed.value = false
    prevKey.current = key

    document.body.classList.toggle('sidebar-closed', !!coords && sidebarClosed.value)

    bump((n) => n + 1)
  })

  if (!coords) return <>{children}</>

  const closed = sidebarClosed.value ? '-closed' : undefined
  const onClose = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    sidebarClosed.value = true
    document.body.classList.add('sidebar-closed')
    window.engine?.resize()
  }
  const close = (
    <button type="button" class="sidebar-close" title="close" onClick={onClose}>
      x
    </button>
  )

  // /play etc: push panel — world slot + one aside. Client sizes to .client-world.
  if (isFullClientPath(path)) {
    const parcel = selectNearestEditableParcel()
    let panel: VNode | null = null
    if (parcel && isAuthoring(parcel.id) && uiPane.value !== 'broadcast') {
      panel = (
        <aside class={closed}>
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      const paneId = uiPane.value
      const showClose = paneId === 'broadcast' || isPersistentPane(paneId)
      panel = (
        <aside class={[paneId === 'broadcast' ? '-broadcast-open' : '', closed].filter(Boolean).join(' ') || undefined}>
          {showClose && close}
          <InWorldPane id={paneId} />
        </aside>
      )
    }
    return (
      <>
        <div class="client-world" />
        {panel}
      </>
    )
  }

  // parcel/embed pages: page HTML stays; in-world pane sits beside when open
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
