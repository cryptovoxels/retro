import type { ComponentChildren, VNode } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, nearestEditableParcel, selectNearestEditableParcel, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { isFullClientPath } from './helpers/coords-nav'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  path?: string
  children: ComponentChildren
}

function closePane(e: Event) {
  e.preventDefault()
  e.stopPropagation()

  // broadcast stays mounted while live - just collapse so the world goes full-bleed
  if (uiPane.value === 'broadcast') {
    sidebarClosed.value = true
    document.body.classList.add('sidebar-closed')
    window.engine?.resize()
    return
  }

  // everything else: clear the pane (and tools / authoring) so the aside unmounts
  if (window.ui?.closeWithPointerLock) {
    window.ui.closeWithPointerLock()
  } else {
    uiPane.value = undefined
    uiAsideTick.value++
  }
}

function CloseButton() {
  return (
    <button type="button" class="sidebar-close" title="close" onClick={closePane}>
      &times;
    </button>
  )
}

export function WorldSidebar({ coords, path, children }: Props) {
  const [, bump] = useState(0)
  const prevKey = useRef('')

  useEffect(() => {
    return () => document.body.classList.remove('sidebar-closed')
  }, [])

  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    nearestEditableParcel.value
    sidebarClosed.value

    // authoring alone must not keep the aside up - edit is contextual and dies with uiPane
    const key = uiPane.value || ''
    if (key && key !== prevKey.current) sidebarClosed.value = false
    prevKey.current = key

    document.body.classList.toggle('sidebar-closed', !!coords && sidebarClosed.value)
    bump((n) => n + 1)
  })

  if (!coords) return <>{children}</>

  const closed = sidebarClosed.value ? '-closed' : undefined

  // /play etc: push panel — world slot + one aside. Client sizes to .client-world.
  if (isFullClientPath(path)) {
    const parcel = selectNearestEditableParcel()
    let panel: VNode | null = null
    if (parcel && isAuthoring(parcel.id) && uiPane.value && uiPane.value !== 'broadcast') {
      panel = (
        <aside class={closed}>
          <CloseButton />
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      const paneId = uiPane.value
      panel = (
        <aside class={[paneId === 'broadcast' ? '-broadcast-open' : '', closed].filter(Boolean).join(' ') || undefined}>
          <CloseButton />
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
        <CloseButton />
        <InWorldPane id="broadcast" />
      </aside>
    )
  } else {
    const parcel = selectNearestEditableParcel()
    if (parcel && isAuthoring(parcel.id) && uiPane.value) {
      pane = (
        <aside class={closed}>
          <CloseButton />
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      pane = (
        <aside class={closed}>
          <CloseButton />
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
