import type { ComponentChildren } from 'preact'
import { useSignalEffect } from '@preact/signals'
import { useState } from 'preact/hooks'
import { uiAsideTick } from '../../src/store'
import { isFullClientPath, paneFromPath, routePane } from './helpers/coords-nav'
import { InWorldPane } from './in-world-pane'

type Props = {
  coords: string
  path?: string
  children: ComponentChildren
}

export function WorldSidebar({ path, children }: Props) {
  const [, bump] = useState(0)
  useSignalEffect(() => {
    uiAsideTick.value
    bump((n) => n + 1)
  })

  if (!isFullClientPath(path)) return <>{children}</>

  const pane = paneFromPath(path)
  return (
    <>
      <div class="client-world" />
      {pane && (
        <aside>
          <button type="button" class="sidebar-close" title="close" onClick={() => routePane()}>
            x
          </button>
          <InWorldPane id={pane} />
        </aside>
      )}
    </>
  )
}
