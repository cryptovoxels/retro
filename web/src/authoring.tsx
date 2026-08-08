import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import type Parcel from '../../src/parcel'
import { authoring, uiAsideTick, uiPane } from '../../src/store'
import type UserInterface from '../../src/user-interface'

declare global {
  interface Window {
    ui?: UserInterface
  }
}

export function Authoring({ parcel }: { parcel: Parcel }) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    authoring.value
    uiPane.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  const ui = window.ui
  if (!ui) return null

  const pane = uiPane.value
  // no pane = no aside content (do not fall back to a bare feature tree)
  if (!pane) return null
  return ui.paneContent(pane as any)
}
