import type { ComponentChildren, VNode } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useRef, useState } from 'preact/hooks'
import { authoring, isAuthoring, nearestEditableParcel, selectNearestEditableParcel, uiAsideTick, uiPane } from '../../src/store'
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

  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    nearestEditableParcel.value

    const parcel = selectNearestEditableParcel()
    const key = uiPane.value || (parcel && isAuthoring(parcel.id) ? `auth:${parcel.id}` : '')
    prevKey.current = key
    bump((n) => n + 1)
  })

  if (!coords) return <>{children}</>

  // /play etc: push panel — world slot + one aside. Client sizes to .client-world.
  if (isFullClientPath(path)) {
    const parcel = selectNearestEditableParcel()
    let panel: VNode | null = null
    if (parcel && isAuthoring(parcel.id) && uiPane.value !== 'broadcast') {
      panel = (
        <aside>
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      const paneId = uiPane.value
      panel = (
        <aside class={paneId === 'broadcast' ? '-broadcast-open' : undefined}>
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
      <aside class="-broadcast-open">
        <InWorldPane id="broadcast" />
      </aside>
    )
  } else {
    const parcel = selectNearestEditableParcel()
    if (parcel && isAuthoring(parcel.id)) {
      pane = (
        <aside>
          <Authoring parcel={parcel} />
        </aside>
      )
    } else if (uiPane.value) {
      pane = (
        <aside>
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
