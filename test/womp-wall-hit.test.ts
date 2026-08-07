import { describe, expect, it } from 'vitest'
import { tileIndexFromUv, WOMP_WALL_GAP, WOMP_WALL_HEADER_FRAC } from '../src/features/womp-wall-hit'

describe('womp-wall tile hit', () => {
  it('ignores header', () => {
    expect(tileIndexFromUv(0.5, 0.95)).toBe(-1)
  })

  it('hits top-left tile (index 0)', () => {
    const canvasV = WOMP_WALL_HEADER_FRAC + (1 - WOMP_WALL_HEADER_FRAC) * (WOMP_WALL_GAP + ((1 - WOMP_WALL_GAP * 4) / 3) * 0.5)
    const v = 1 - canvasV
    const u = WOMP_WALL_GAP + ((1 - WOMP_WALL_GAP * 4) / 3) * 0.5
    expect(tileIndexFromUv(u, v)).toBe(0)
  })

  it('hits bottom-right tile (index 5)', () => {
    const cellW = (1 - WOMP_WALL_GAP * 4) / 3
    const cellH = (1 - WOMP_WALL_GAP * 3) / 2
    const gridV = WOMP_WALL_GAP + 1 * (cellH + WOMP_WALL_GAP) + cellH * 0.5
    const canvasV = WOMP_WALL_HEADER_FRAC + (1 - WOMP_WALL_HEADER_FRAC) * gridV
    const v = 1 - canvasV
    const u = WOMP_WALL_GAP + 2 * (cellW + WOMP_WALL_GAP) + cellW * 0.5
    expect(tileIndexFromUv(u, v)).toBe(5)
  })
})
