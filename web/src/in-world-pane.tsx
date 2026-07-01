import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { currentOrNearestParcel, currentParcel, uiAsideTick } from '../../src/store'
import type UserInterface from '../../src/user-interface'

declare global {
  interface Window {
    ui?: UserInterface
  }
}

export function InWorldPane({ id }: { id: string }) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    uiAsideTick.value
    // the parcel resolves after the engine boots; re-render so a pane rendered before
    // window.ui existed (e.g. the default info pane on /play) fills in instead of staying blank.
    // currentParcel flips the info pane between parcel details and island context as you move.
    currentOrNearestParcel.value
    currentParcel.value
    bump((n) => n + 1)
  })

  const ui = window.ui
  if (!ui) return null
  return ui.paneContent(id as any)
}
