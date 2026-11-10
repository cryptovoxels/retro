import { seeded } from '../../../common/helpers/utils'
import type { Road } from '../layout'

const styles = ['adobo', 'homer', 'ned', 'saloon', 'mall', 'kwik-e-mart', 'thrift store', 'record shop', 'town square', 'cinema'] as const

export function buildingStyle(x: number, z: number) {
  const draw = seeded(Math.imul(x, 7919) ^ Math.imul(z, 104729))()
  return styles[Math.floor(Math.log(1 - draw * (1 - 0.76 ** styles.length)) / Math.log(0.76))]
}

export function doorCell(style: string, width: number) {
  return style === 'homer' ? Math.max(2, Math.floor(width * 0.28)) : Math.floor(width / 2)
}

// Paint the doorstep in half-metre cells. The outer row steps in at each corner.
export function entrances(parcels: (Road & { door?: string; is_common?: boolean })[], cx: number, cz: number, paint: (x: number, z: number, tile: number) => void) {
  for (const p of parcels) {
    const face = p.door
    if (!face || p.is_common) continue
    const side = face === 'e' || face === 'w'
    const width = 2 * (side ? p.z2 - p.z1 : p.x2 - p.x1)
    const style = buildingStyle(Math.round(cx * 100) + p.x1, Math.round(cz * 100) + p.z1)
    const door = doorCell(style, width)
    for (let row = 0; row < 2; row++) {
      const half = style === 'mall' || style === 'town square' ? 4 : 3
      for (let u = Math.max(0, door - half + row); u < Math.min(width, door + half - row); u++) {
        const x = face === 'e' ? 2 * p.x2 + row : face === 'w' ? 2 * p.x1 - row - 1 : face === 's' ? 2 * p.x2 - 1 - u : 2 * p.x1 + u
        const z = face === 'n' ? 2 * p.z2 + row : face === 's' ? 2 * p.z1 - row - 1 : face === 'e' ? 2 * p.z2 - 1 - u : 2 * p.z1 + u
        paint(x, z, style === 'town square' ? 65 : 64)
      }
    }
  }
}
