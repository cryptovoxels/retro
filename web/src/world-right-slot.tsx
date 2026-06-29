import type { ComponentChildren } from 'preact'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  pane: string
  children: ComponentChildren
}

export function WorldRightSlot({ coords, pane, children }: Props) {
  if (!coords) return <>{children}</>

  return <aside>{pane ? <InWorldPane id={pane} /> : children}</aside>
}
