import { signal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'

// page-provided sidebar content (home / parcel pages). Panes take priority; when no
// pane is open the WorldSidebar aside shows this. Lives in its own module so pages
// can import WorldAside without dragging the engine store into the server bundle.
export const pageAside = signal<ComponentChildren | null>(null)

/**
 * Pages hand their sidebar content to the one WorldSidebar aside. Panes
 * (Explore/Settings/...) take priority; this shows when no pane is open.
 */
export function WorldAside({ children }: { children: ComponentChildren }) {
  // no deps: children close over fresh page state, republish after every page render
  useEffect(() => {
    pageAside.value = children
  })
  useEffect(
    () => () => {
      pageAside.value = null
    },
    [],
  )
  return null
}
