import { seeded } from '../../../common/helpers/utils'
import { getBlockId } from '../../../common/content/blocks'
import type { VillageOpts, VillageParcel } from './village'
import cities from './texas-streets.json'

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
  const pitch = (side + 3) * 2 + 12
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
        const width = Math.max(3, Math.min(side + 1, Math.round(side * (1 + (rand() - 0.5) * opts.areaSpread))))
        const depth = Math.max(3, Math.min(side + 2, Math.round((opts.area / width) * (1 + (rand() - 0.5) * opts.areaSpread))))
        const cap = deadEnd && n === count - 1
        const offset = 3 + Math.floor(n / 2) * (side + 2)
        const x1 = cap ? (east ? end : end - depth) : x + (east ? offset : -offset - width)
        const z1 = cap ? along - Math.floor(width / 2) : north ? along + 2 : along - 2 - depth
        // Published parcel bounds use whole metres. The road can still step by half a metre.
        const y1 = Math.round(terrace(x1 + width / 2, along, opts.reroll, true))
        parcels.push({
          id: 0,
          suburb: city,
          address: Math.floor(((n + 1) * (1 + Math.sqrt(5))) / 2) + ' ' + name,
          x1,
          x2: x1 + (cap ? depth : width),
          z1,
          z2: z1 + (cap ? width : depth),
          y1,
          y2: y1 + Math.max(4, Math.round(opts.height * (1 + (rand() - 0.5) * 2 * opts.heightSpread)) + 1),
          door: cap ? (east ? 'w' : 'e') : north ? 's' : 'n',
          material: getBlockId([2, 4, 5, 6, 8, 9, 14][Math.floor(rand() * 7)], 0),
        })
      }
    }
  }
  return { parcels, roads, spawn }
}
