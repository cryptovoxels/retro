/** ArrowUp/Down moves focus among items; Enter clicks the focused one. */
export function onListArrowKeys(e: KeyboardEvent, itemSelector = 'a, [tabindex]') {
  if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp' && e.code !== 'Enter') return
  const root = e.currentTarget as HTMLElement
  const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector))
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) {
    e.preventDefault()
    e.stopPropagation()
    items[e.code === 'ArrowUp' ? items.length - 1 : 0]?.focus()
    return
  }
  if (e.code === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    ;(document.activeElement as HTMLElement | null)?.click()
    return
  }
  e.preventDefault()
  e.stopPropagation()
  items[e.code === 'ArrowDown' ? i + 1 : i - 1]?.focus()
}

/** Focus the first navigable item under root. */
export function focusFirst(root: ParentNode | string, itemSelector = 'a, [tabindex]') {
  const el = typeof root === 'string' ? document.querySelector(root) : root
  el?.querySelector<HTMLElement>(itemSelector)?.focus()
}
