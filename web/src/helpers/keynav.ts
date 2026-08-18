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

/** Count columns from the first row's layout (works with CSS grid / wrap). */
function gridColumns(items: HTMLElement[]) {
  if (items.length < 2) return 1
  const top = items[0].offsetTop
  let cols = 1
  while (cols < items.length && items[cols].offsetTop === top) cols++
  return cols
}

/** Arrow keys move in 2D across a grid; Enter clicks. */
export function onGridArrowKeys(e: KeyboardEvent, itemSelector = 'a, [tabindex]') {
  if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp' && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'Enter') return
  const root = e.currentTarget as HTMLElement
  const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector))
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) {
    e.preventDefault()
    e.stopPropagation()
    items[0]?.focus()
    return
  }
  if (e.code === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    ;(document.activeElement as HTMLElement | null)?.click()
    return
  }
  const cols = gridColumns(items)
  let next = i
  if (e.code === 'ArrowLeft') next = i - 1
  else if (e.code === 'ArrowRight') next = i + 1
  else if (e.code === 'ArrowUp') next = i - cols
  else if (e.code === 'ArrowDown') next = i + cols
  if (next < 0 || next >= items.length) return
  e.preventDefault()
  e.stopPropagation()
  items[next]?.focus()
}

/** Focus the first navigable item under root. */
export function focusFirst(root: ParentNode | string, itemSelector = 'a, [tabindex]') {
  const el = typeof root === 'string' ? document.querySelector(root) : root
  el?.querySelector<HTMLElement>(itemSelector)?.focus()
}
