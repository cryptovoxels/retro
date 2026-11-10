import { seeded } from '../../common/helpers/utils'
import { getBlockId } from '../../common/content/blocks'
import type { VillageOpts, VillageParcel } from '../../web/src/admin/village'
import cities from './streets.json'
import pack from './artpack.json'

export type Road = { x1: number; x2: number; z1: number; z2: number; dirt?: boolean; name?: string; suburb?: string; deadEnd?: boolean }

// A spine and five cross streets per district. Each half of a cross street has its own addresses.
const places: Record<keyof typeof cities, [number, number]> = {
  Houston: [3, 1],
  'San Antonio': [2, 0],
  Dallas: [3, 2],
  'Fort Worth': [1, 2],
  Austin: [2, 1],
  'El Paso': [0, 1],
  Arlington: [1, 1],
  'Corpus Christi': [2, -1],
  Plano: [2, 2],
  Lubbock: [1, 3],
}

// Two broad shelves and a high western escarpment. Roads cut half-metre steps through it.
export function terrace(x: number, z: number, seed: number, road = false) {
  const edge = -35 + Math.round(10 * Math.sin(z / 55 + seed))
  const west = road ? Math.max(0, Math.min(8, Math.floor((edge - x + 12) / 3))) : x < edge ? 8 : 0
  const rim = 65 + 12 * Math.sin(x / 60)
  const north = road ? Math.max(0, Math.min(3, Math.floor((z - rim + 4) / 3))) : z > rim ? 3 : 0
  const mesa = Math.min(75 - Math.abs(x - 12), 40 - Math.abs(z + 115))
  const bluff = road ? Math.max(0, Math.min(4, Math.floor(mesa / 3))) : mesa > 0 ? 4 : 0
  return Math.min(12, west + north + bluff) / 2
}

export function texas(opts: VillageOpts) {
  const rand = seeded(opts.reroll + 736)
  const side = Math.ceil(Math.sqrt(opts.area))
  const slots = Math.max(1, Math.ceil(opts.count / 200))
  const half = (slots + 1) * (side + 2) + 4
  const pitch = Math.max((side + 3) * 2 + 12, 3 * side + 8)
  const parcels: VillageParcel[] = []
  const roads: Road[] = []
  const spawn: [number, number] = [0, 0]
  let street = 0
  for (const city of Object.keys(cities) as (keyof typeof cities)[]) {
    const [cx, cz] = places[city]
    const x = (cx - 1.5) * 2 * half
    const z = (cz - 1) * 5 * pitch
    if (parcels.length >= opts.count) break
    roads.push({ name: opts.streets[street] || cities[city][0], suburb: city, x1: x - 2, x2: x + 2, z1: z - 2.5 * pitch, z2: z + 2.5 * pitch })
    for (let j = 0; j < 10; j++, street++) {
      const count = Math.floor(opts.count / 100) + Number(street < opts.count % 100)
      if (!count) continue
      const along = z + (Math.floor(j / 2) - 2) * pitch
      const east = j % 2 === 1
      const deadEnd = count >= 3 && (street + opts.reroll) % 3 === 1
      const parkStreet = j === ((street - j + opts.reroll) % 3 === 1 ? 1 : 0)
      const park = Math.floor(street / 10) % 2 ? 'campfire' : 'mesa'
      const distance = deadEnd ? half - side - 3 : half
      const end = x + (east ? distance : -distance)
      const left = east ? x + 2 : end
      const name = opts.streets[street] || cities[city][j]
      roads.push({ name, suburb: city, deadEnd, x1: left, x2: east ? end : x - 2, z1: along - 2, z2: along + 2, dirt: j >= 8 })
      if (!street) {
        spawn[0] = x
        spawn[1] = along + pitch / 2
      }
      for (let n = 0; n < count; n++) {
        const north = n % 2 === 0
        const lotWidth = Math.max(3, Math.min(side + 1, Math.round(side * (1 + (rand() - 0.5) * opts.areaSpread))))
        const lotDepth = Math.max(3, Math.min(side + 2, Math.round((opts.area / lotWidth) * (1 + (rand() - 0.5) * opts.areaSpread))))
        const commons = parkStreet && n === 0
        const mesaWidth = 2 * (side + 2)
        const width = commons && park === 'mesa' ? mesaWidth : lotWidth
        const depth = commons ? Math.max(lotDepth, Math.min(Math.round(side * 2.5), pitch - 6 - (side + 2))) : lotDepth
        const cap = deadEnd && n === count - 1
        const offset = 3 + Math.floor(n / 2) * (side + 2) + (parkStreet && park === 'mesa' && north && n > 0 ? mesaWidth - side - 2 : 0)
        const x1 = cap ? (east ? end : end - depth) : x + (east ? offset : -offset - width)
        const z1 = cap ? along - Math.floor(width / 2) : north ? along + 2 : along - 2 - depth
        // Published parcel bounds use whole metres. The road can still step by half a metre.
        const y1 = Math.round(terrace(x1 + width / 2, along, opts.reroll, true))
        const houseHeight = Math.max(4, Math.round(opts.height * (1 + (rand() - 0.5) * 2 * opts.heightSpread)) + 1)
        parcels.push({
          id: 0,
          suburb: city,
          ...(commons && { is_common: true, common: park }),
          address: Math.floor(((n + 1) * (1 + Math.sqrt(5))) / 2) + ' ' + name,
          x1,
          x2: x1 + (cap ? depth : width),
          z1,
          z2: z1 + (cap ? width : depth),
          y1,
          y2: y1 + (commons && park === 'mesa' ? 1 + Math.ceil(2.5 * Math.min(2 * houseHeight - 3, lotWidth)) : houseHeight),
          door: cap ? (east ? 'w' : 'e') : north ? 's' : 'n',
          material: getBlockId(pack.frames.tiles[Math.floor(rand() * pack.frames.tiles.length)], 0),
        })
      }
    }
  }
  return { parcels, roads, spawn }
}

export function creekBeds(roads: Road[], x: number, w: number, seed: number) {
  const streets = roads.filter((r) => r.x2 - r.x1 > r.z2 - r.z1)
  const rows = [...new Set(streets.map((r) => (r.z1 + r.z2) / 2))].sort((a, b) => a - b)
  const above = rows.find((v) => v > 0) || 0
  const below = [...rows].reverse().find((v) => v <= 0) || 0
  const creeks = [(above + below) / 2]
  const pitch = above - below
  if (pitch > 0) {
    const first = streets.find((r) => r.suburb === 'Houston')
    if (first) creeks.push((first.z1 + first.z2 + pitch) / 2)
    for (let i = 2; i < rows.length - 1; i += 4) creeks.push((rows[i] + rows[i + 1]) / 2)
  }
  return Array.from({ length: w }, (_, i) => creeks.map((z, j) => z + (j === 0 ? 2 : 3) * Math.sin((x + i) / (23 + j * 2) + seed + j)))
}
