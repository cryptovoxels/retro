import { getCoords } from './helpers/coords-nav'
import { route } from 'preact-router'

function goBack(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  history.back()
}

/** Sticky back + X for the right column (.page / .ui-pane). */
export function SidebarClose({ onClick }: { onClick: (e: Event) => void }) {
  return (
    <div class="sidebar-chrome">
      <button type="button" class="sidebar-back" title="back" onClick={goBack}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="miter" aria-hidden="true">
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>
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
