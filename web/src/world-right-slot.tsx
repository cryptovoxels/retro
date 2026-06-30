import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { authoring, isAuthoring, nearestEditableParcel, selectNearestEditableParcel, uiAsideTick, uiPane } from '../../src/store'
import { Authoring } from './authoring'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  children: ComponentChildren
}

export function WorldRightSlot({ coords, children }: Props) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    nearestEditableParcel.value
    bump((n) => n + 1)
  })

  if (!coords) return <>{children}</>

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
  return <aside>{pane ? <InWorldPane id={pane} /> : children}</aside>
}
