export const WOMP_WALL_COLS = 3
export const WOMP_WALL_ROWS = 2
export const WOMP_WALL_TILES = WOMP_WALL_COLS * WOMP_WALL_ROWS
export const WOMP_WALL_HEADER_FRAC = 0.18
export const WOMP_WALL_GAP = 0.02

/** Map plane local u/v (0..1, v from bottom) to tile index, or -1 for header/gaps. */
export function tileIndexFromUv(u: number, v: number): number {
  const canvasV = 1 - v
  if (canvasV < WOMP_WALL_HEADER_FRAC) return -1
  if (u < 0 || u > 1 || canvasV > 1) return -1

  const gridU = u
  const gridV = (canvasV - WOMP_WALL_HEADER_FRAC) / (1 - WOMP_WALL_HEADER_FRAC)
  const gap = WOMP_WALL_GAP
  const cellW = (1 - gap * (WOMP_WALL_COLS + 1)) / WOMP_WALL_COLS
  const cellH = (1 - gap * (WOMP_WALL_ROWS + 1)) / WOMP_WALL_ROWS

  for (let row = 0; row < WOMP_WALL_ROWS; row++) {
    for (let col = 0; col < WOMP_WALL_COLS; col++) {
      const x0 = gap + col * (cellW + gap)
      const y0 = gap + row * (cellH + gap)
      if (gridU >= x0 && gridU <= x0 + cellW && gridV >= y0 && gridV <= y0 + cellH) {
        return row * WOMP_WALL_COLS + col
      }
    }
  }
  return -1
}
