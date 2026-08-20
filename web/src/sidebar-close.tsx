import { getCoords } from './helpers/coords-nav'
import { route } from 'preact-router'

/** Sticky X for the right column (.page / .ui-pane). */
export function SidebarClose({ onClick }: { onClick: (e: Event) => void }) {
  return (
    <div class="sidebar-chrome">
      <button type="button" class="sidebar-close" title="close" onClick={onClick}>
        &times;
      </button>
    </div>
  )
}

/** Hide the page column: full-bleed world via /play. */
export function closePageSidebar(e?: Event) {
  e?.preventDefault()
  e?.stopPropagation()
  const c = getCoords()
  route(c ? `/play?coords=${encodeURIComponent(c)}` : '/play')
}
