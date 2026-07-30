export const PALETTE_HEX = [
  '#ff0040',
  '#131313',
  '#1b1b1b',
  '#272727',
  '#3d3d3d',
  '#5d5d5d',
  '#858585',
  '#b4b4b4',
  '#ffffff',
  '#c7cfdd',
  '#92a1b9',
  '#657392',
  '#424c6e',
  '#2a2f4e',
  '#1a1932',
  '#0e071b',
  '#1c121c',
  '#391f21',
  '#5d2c28',
  '#8a4836',
  '#bf6f4a',
  '#e69c69',
  '#f6ca9f',
  '#f9e6cf',
  '#edab50',
  '#e07438',
  '#c64524',
  '#8e251d',
  '#ff5000',
  '#ed7614',
  '#ffa214',
  '#ffc825',
  '#ffeb57',
  '#d3fc7e',
  '#99e65f',
  '#5ac54f',
  '#33984b',
  '#1e6f50',
  '#134c4c',
  '#0c2e44',
  '#00396d',
  '#0069aa',
  '#0098dc',
  '#00cdf9',
  '#0cf1ff',
  '#94fdff',
  '#fdd2ed',
  '#f389f5',
  '#db3ffd',
  '#7a09fa',
  '#3003d9',
  '#0c0293',
  '#03193f',
  '#3b1443',
  '#622461',
  '#93388f',
  '#ca52c9',
  '#c85086',
  '#f68187',
  '#f5555d',
  '#ea323c',
  '#c42430',
  '#891e2b',
  '#571c27',
] as const

export const PALETTE_COLOR_COUNT = 64
if (PALETTE_HEX.length !== PALETTE_COLOR_COUNT) {
  throw new Error(`Palette expected ${PALETTE_COLOR_COUNT} colors, got ${PALETTE_HEX.length}`)
}

/** Linear RGBA for GPU storage buffer (shader samples this). */
export const palette = new Float32Array(PALETTE_COLOR_COUNT * 4)

const PALETTE_RGB = PALETTE_HEX.map((hex) => ({
  r: Number.parseInt(hex.slice(1, 3), 16) / 255,
  g: Number.parseInt(hex.slice(3, 5), 16) / 255,
  b: Number.parseInt(hex.slice(5, 7), 16) / 255,
}))

/** Linear RGB 0..1 for a packed voxel color index (low 6 bits = palette slot). */
export function linearRgbFromPaletteIndex(index: number): {
  r: number
  g: number
  b: number
} {
  // slot 0 is unusable (VoxelData treats 0 as air); clamp to 1..63
  const i = Math.max(1, Math.min(PALETTE_COLOR_COUNT - 1, index & 0x3f))
  const hex = PALETTE_HEX[i]
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  }
}

export function nearestPaletteIndexFromRgb(r: number, g: number, b: number): number {
  // skip slot 0 — byte 0 means air in VoxelData / the shader
  let bestIndex = 1
  let bestDist2 = Number.POSITIVE_INFINITY
  for (let i = 1; i < PALETTE_RGB.length; i++) {
    const c = PALETTE_RGB[i]
    const dr = c.r - r
    const dg = c.g - g
    const db = c.b - b
    const dist2 = dr * dr + dg * dg + db * db
    if (dist2 < bestDist2) {
      bestDist2 = dist2
      bestIndex = i
    }
  }
  return bestIndex
}

export function fillPalette(): void {
  for (let i = 0; i < PALETTE_COLOR_COUNT; i++) {
    const hex = PALETTE_HEX[i]
    const base = i * 4
    palette[base + 0] = Number.parseInt(hex.slice(1, 3), 16) / 255
    palette[base + 1] = Number.parseInt(hex.slice(3, 5), 16) / 255
    palette[base + 2] = Number.parseInt(hex.slice(5, 7), 16) / 255
    palette[base + 3] = 1
  }
}

// r,g,b 0..1
export function getColor(r: number, g: number, b: number): number {
  return nearestPaletteIndexFromRgb(r, g, b)
}

// #rrggbb
export function getHexColor(hex: String) {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  return getColor(r, g, b)
}
