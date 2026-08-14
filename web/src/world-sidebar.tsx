import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, nearestEditableParcel, selectNearestEditableParcel, sidebarClosed, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { isEmbedClientPath, isFullClientPath } from './helpers/coords-nav'
import { InWorldPane } from './in-world-pane'
import { pageAside } from './world-aside'

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

  if (uiPane.value) {
    // pane open: clear it (and tools / authoring); falls back to page content if any
    if (window.ui?.closeWithPointerLock) {
      window.ui.closeWithPointerLock()
    } else {
      uiPane.value = undefined
      uiAsideTick.value++
    }
    return
  }

  // page content showing: collapse in place, world goes full-bleed
  sidebarClosed.value = true
  document.body.classList.add('sidebar-closed')
  window.engine?.resize()
}

function CloseButton() {
  return (
    <button type="button" class="sidebar-close" title="close" onClick={closePane}>
      &times;
    </button>
  )
}

// The one aside. Separate component so pane/pageAside signal changes don't
// re-render the routed page (which republishes pageAside - that would loop).
function WorldAsideHost() {
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
    pageAside.value

    // opening a pane always reveals the sidebar
    const key = uiPane.value || ''
    if (key && key !== prevKey.current) sidebarClosed.value = false
    prevKey.current = key

    document.body.classList.toggle('sidebar-closed', sidebarClosed.value)
    bump((n) => n + 1)
  })

  const closed = sidebarClosed.value ? '-closed' : undefined
  const parcel = selectNearestEditableParcel()

  let content: ComponentChildren = null
  let kind = ''

  if (uiPane.value === 'broadcast') {
    kind = '-broadcast-open'
    content = <InWorldPane id="broadcast" />
  } else if (parcel && isAuthoring(parcel.id) && uiPane.value) {
    // authoring alone must not keep the aside up - edit is contextual and dies with uiPane
    content = <Authoring parcel={parcel} />
  } else if (uiPane.value) {
    content = <InWorldPane id={uiPane.value} />
  } else {
    kind = 'page-aside'
    content = pageAside.value
  }

  if (!content) return null

  return (
    <aside class={[kind, closed].filter(Boolean).join(' ') || undefined}>
      <CloseButton />
      {content}
    </aside>
  )
}

export function WorldSidebar({ coords, path, children }: Props) {
  const [, bump] = useState(0)
  const hadAside = useRef(!!pageAside.value)

  // re-render only when page content appears/disappears - subscribing to every
  // pageAside publish would re-render children, which republish, which loops
  useSignalEffect(() => {
    const has = !!pageAside.value
    if (has === hadAside.current) return
    hadAside.current = has
    bump((n) => n + 1)
  })

  // /play /scratchpad: push panel - world slot + one aside. Client sizes to .client-world.
  if (isFullClientPath(path)) {
    return (
      <>
        <div class="client-world" />
        <WorldAsideHost />
      </>
    )
  }

  // host mounts for world pages (coords), embed pages without ?coords= (spaces/assets),
  // and pages that declared sidebar content (home/parcel before the world boots)
  if (!coords && !isEmbedClientPath(path) && !pageAside.value) return <>{children}</>

  // womp detail page owns its .columns aside - don't stack explore/tools on top of it
  if (path && /^\/womps\/\d+/.test(path)) return <>{children}</>

  // home / parcel / embed pages: page HTML stays; the one aside swaps page content and panes
  return (
    <>
      {children}
      <WorldAsideHost />
    </>
  )
}
