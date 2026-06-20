// ABOUTME: Fixed 6x6x6 web-safe voxel palette shared by the asset migration and client far-LOD render.
// ABOUTME: One byte per voxel. Index 0 = empty. Indices 1..216 = web-safe cube. Mapping is O(1), no lookup table.

const LEVELS = [0, 51, 102, 153, 204, 255]

export const VOX_PALETTE: [number, number, number][] = (() => {
  const p: [number, number, number][] = [[0, 0, 0]]
  for (const r of LEVELS) for (const g of LEVELS) for (const b of LEVELS) p.push([r, g, b])
  return p
})()

// Nearest web-safe index for an rgb colour. Returns 1..216 (never 0; 0 is reserved for empty).
export const nearestPaletteIndex = (r: number, g: number, b: number): number => {
  const q = (v: number) => Math.min(5, Math.max(0, Math.round(v / 51)))
  return q(r) * 36 + q(g) * 6 + q(b) + 1
}
