export type CohostPaneRect = { x: number; y: number; w: number; h: number }

// host-anchored split screen: pane 0 is the host/anchor. two people keep the classic
// half-and-half; with more, the host holds one half and the guests pack into the other
// (a column of 2, or a 2x2 grid for 3-4 guests). max 5 on screen: host + 4 guests.
export const MAX_COHOST_PANES = 5

export function cohostPaneRects(count: number, w: number, h: number, portrait: boolean): CohostPaneRect[] {
  const n = Math.max(1, Math.min(count, MAX_COHOST_PANES))
  if (n === 1) return [{ x: 0, y: 0, w, h }]
  if (n === 2) {
    return portrait
      ? [
          { x: 0, y: 0, w, h: h / 2 },
          { x: 0, y: h / 2, w, h: h / 2 },
        ]
      : [
          { x: 0, y: 0, w: w / 2, h },
          { x: w / 2, y: 0, w: w / 2, h },
        ]
  }
  const guests = n - 1
  const cols = guests <= 2 ? (portrait ? guests : 1) : 2
  const rows = guests <= 2 ? (portrait ? 1 : guests) : 2
  const rects: CohostPaneRect[] = []
  if (portrait) {
    // host on top, guests below
    rects.push({ x: 0, y: 0, w, h: h / 2 })
    const cw = w / cols
    const ch = h / 2 / rows
    for (let i = 0; i < guests; i++) {
      rects.push({ x: (i % cols) * cw, y: h / 2 + Math.floor(i / cols) * ch, w: cw, h: ch })
    }
  } else {
    // host on the left, guests on the right
    rects.push({ x: 0, y: 0, w: w / 2, h })
    const cw = w / 2 / cols
    const ch = h / rows
    for (let i = 0; i < guests; i++) {
      rects.push({ x: w / 2 + (i % cols) * cw, y: Math.floor(i / cols) * ch, w: cw, h: ch })
    }
  }
  return rects
}
