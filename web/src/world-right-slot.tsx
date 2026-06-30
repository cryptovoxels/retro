import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { uiAsideTick, uiPane } from '../../src/store'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  children: ComponentChildren
}

export function WorldRightSlot({ coords, children }: Props) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    uiPane.value
    uiAsideTick.value
    bump((n) => n + 1)
  })

  if (!coords) return <>{children}</>

  const pane = uiPane.value
  return <aside>{pane ? <InWorldPane id={pane} /> : children}</aside>
}
