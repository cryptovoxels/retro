// LEGO solids curated from https://github.com/boneskull/lego-color-swatches
// slot 0 is air (unusable); slots 1..63 are colors
export const PALETTE_HEX = [
  '#000000', // air (unused)
  '#B3D7D1', // Aqua
  '#05131D', // Black
  '#0055BF', // Blue
  '#6874CA', // Blue-Violet
  '#4B9F4A', // Bright Green
  '#9FC3E9', // Bright Light Blue
  '#F8BB3D', // Bright Light Orange
  '#FFF03A', // Bright Light Yellow
  '#E4ADC8', // Bright Pink
  '#583927', // Brown
  '#AE7A59', // Copper
  '#078BC9', // Dark Azure
  '#0A3463', // Dark Blue
  '#2032B0', // Dark Blue-Violet
  '#6C6E68', // Dark Bluish Grey
  '#352100', // Dark Brown
  '#7C503A', // Dark Flesh
  '#184632', // Dark Green
  '#6D6E5C', // Dark Grey
  '#A95500', // Dark Orange
  '#C870A0', // Dark Pink
  '#3F3691', // Dark Purple
  '#720E0F', // Dark Red
  '#958A73', // Dark Tan
  '#008F9B', // Dark Turquoise
  '#FA9C1C', // Earth Orange
  '#D09168', // Flesh
  '#237841', // Green
  '#E1D5ED', // Lavender
  '#A0A5A9', // Light Bluish Grey
  '#F6D7B3', // Light Flesh
  '#C2DAB8', // Light Green
  '#9BA19D', // Light Grey
  '#D9E4A7', // Light Lime
  '#F9BA61', // Light Orange
  '#FECCCF', // Light Pink
  '#CD6298', // Light Purple
  '#55A5AF', // Light Turquoise
  '#FBE696', // Light Yellow
  '#BBE90B', // Lime
  '#3592C3', // Maersk Blue
  '#923978', // Magenta
  '#36AEBF', // Medium Azure
  '#5A93DB', // Medium Blue
  '#CC702A', // Medium Dark Flesh
  '#F785B1', // Medium Dark Pink
  '#73DCA1', // Medium Green
  '#AC78BA', // Medium Lavender
  '#C7D23C', // Medium Lime
  '#FFA70B', // Medium Orange
  '#9B9A5A', // Olive Green
  '#FE8A18', // Orange
  '#FC97AC', // Pink
  '#81007B', // Purple
  '#C91A09', // Red
  '#582A12', // Reddish Brown
  '#4C61DB', // Royal Blue
  '#6074A1', // Sand Blue
  '#A0BCAC', // Sand Green
  '#E4CD9E', // Tan
  '#FFFFFF', // White
  '#F2CD37', // Yellow
  '#DFEEA5', // Yellowish Green
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
