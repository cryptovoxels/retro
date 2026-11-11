import { rockProp } from '../nature'
import { v7 as uuid } from 'uuid'
import { defaultColors, getBlockId } from '../../../common/content/blocks'
import { seeded } from '../../../common/helpers/utils'
import type ParcelBuilder from '../../../server/parcel-builder'
import pack from '../artpack.json'

// Distances are fractions of the parcel. Both the island dirt and the parcel
// cliffs follow this contour across their separate half-metre fields.
export function mesaEdge(x: number, z: number) {
  const rim = Math.hypot((x - 0.55) / 0.39, (z - 0.53) / 0.39)
  const butte = Math.hypot((x - 0.24) / 0.16, (z - 0.65) / 0.23)
  return Math.min(rim, butte) + 0.09 * Math.sin(21 * x + 9 * z)
}

export function mesa(b: ParcelBuilder, face: string, index: number) {
  const w = b.width,
    d = b.depth
  const north = face === 'n'
  const rand = seeded(index + b.parcel.x1 * 131 + b.parcel.z1)
  const colors = [...defaultColors]
  Object.assign(colors, { 1: '#e39054', 2: '#a74d37', 3: '#d66941', 4: '#ebbb84' })
  const peak = 5 * Math.round((b.height - 2) / 5)
  const bands = [2, 3, 3, 1, 2, 4].map((t) => getBlockId(2, t))
  // Leave the floor empty so the continuous island dirt shows through.
  for (let x = 0; x < w; x++)
    for (let z = 0; z < d; z++) {
      const edge = mesaEdge((x + 0.5) / w, north ? (z + 0.5) / d : 1 - (z + 0.5) / d)
      const height = edge < 0.45 ? peak : edge < 0.63 ? Math.round(peak * 0.7) : edge < 0.81 ? Math.round(peak * 0.4) : edge < 1 ? Math.round(peak * 0.17) : 0
      for (let y = 0; height && y < 2 + height; y++) b.field.set(x, y, z, bands[Math.floor(y / 2) % bands.length])
    }
  const features = []
  for (let i = 0; i < 250 && features.length < 18; i++) {
    const x = 0.04 + 0.92 * rand(),
      z = 0.04 + 0.92 * rand(),
      edge = mesaEdge(x, z)
    if (edge < 1.07 || edge > 1.52) continue
    const size = 1 + 2.3 * rand(),
      yaw = Math.floor(rand() * 4) * (Math.PI / 2)
    const rock = pack.rocks[(edge < 1.25 ? 0 : 10) + Math.floor(rand() * 10)]
    features.push({ uuid: uuid(), ...rockProp(rock, 0.25 + (x - 0.5) * w * 0.5, 0.75, 0.25 + (north ? z - 0.5 : 0.5 - z) * d * 0.5, yaw, size) })
  }
  return { ...b.serialize, palette: colors, features, building: 'mesa commons' }
}
