import { packStreets } from './shape'
import { seeded } from '../../common/helpers/utils'
import { getBlockId } from '../../common/content/blocks'
import type { VillageOpts, VillageParcel } from '../../web/src/admin/village'
import cities from './streets.json'
import pack from './artpack.json'

export type Road = { x1: number; x2: number; z1: number; z2: number; dirt?: boolean; name?: string; suburb?: string; deadEnd?: boolean; maskSize?: number }

// Relative district centres steer placement within the supplied Texas outline.
const places: Record<keyof typeof cities, [number, number]> = {
  Houston: [0.26, -0.1],
  'San Antonio': [0.02, -0.2],
  Dallas: [0.17, 0.16],
  'Fort Worth': [0.08, 0.17],
  Austin: [0.09, -0.09],
  'El Paso': [-0.32, 0.03],
  Arlington: [0.13, 0.15],
  'Corpus Christi': [0.15, -0.32],
  Plano: [0.18, 0.2],
  Lubbock: [-0.12, 0.29],
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
  const parcels: VillageParcel[] = []
  const roads: Road[] = []
  const blocks = []
  const counts = Array.from({ length: 100 }, (_, i) => Math.floor(opts.count / 100) + Number(i < opts.count % 100))
  for (let i = 1; i < 99; i += 2) {
    const transfer = Math.min(counts[i] - 3, Math.floor(rand() * 4))
    if (transfer > 0) {
      counts[i] -= transfer
      counts[i + 1] += transfer
    }
  }
  let street = 0
  for (const city of Object.keys(cities) as (keyof typeof cities)[]) {
    for (let j = 0; j < 10; j++, street++) {
      const count = counts[street]
      if (!count) continue
      const east = rand() < 0.5
      const deadEnd = count >= 3 && (street + opts.reroll) % 3 === 1
      const parkStreet = j === ((street - j + opts.reroll) % 3 === 1 ? 1 : 0)
      const park = Math.floor(street / 10) % 2 ? 'campfire' : 'mesa'
      const name = opts.streets[street] || cities[city][j]
      const first = parcels.length
      const frontage = [0, 0]
      let end = 0
      for (let n = 0; n < count; n++) {
        const north = frontage[0] <= frontage[1]
        const lotWidth = Math.max(3, Math.min(side + 1, Math.round(side * (1 + (rand() - 0.5) * opts.areaSpread))))
        const lotDepth = Math.max(3, Math.min(side + 2, Math.round((opts.area / lotWidth) * (1 + (rand() - 0.5) * opts.areaSpread))))
        const commons = parkStreet && n === 0
        const mesaWidth = 2 * (side + 2)
        const width = commons && park === 'mesa' ? mesaWidth : lotWidth
        const depth = commons ? Math.max(lotDepth, Math.round(side * 2.5)) : lotDepth
        const cap = deadEnd && n === count - 1
        const lane = north ? 0 : 1
        const offset = cap ? Math.max(...frontage) : frontage[lane]
        if (!cap) frontage[lane] += width
        end = Math.max(...frontage)
        const x1 = east ? offset : -offset - (cap ? depth : width)
        const z1 = cap ? -Math.floor(width / 2) : north ? 2 : -2 - depth
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
          y1: 0,
          y2: commons && park === 'mesa' ? 1 + Math.ceil(2.5 * Math.min(2 * houseHeight - 3, lotWidth)) : houseHeight,
          door: cap ? (east ? 'w' : 'e') : north ? 's' : 'n',
          material: getBlockId(pack.frames.tiles[Math.floor(rand() * pack.frames.tiles.length)], 0),
        })
      }
      const lots = parcels.slice(first)
      const mouth = east ? -2 : 0
      const spine = { name, suburb: city, x1: mouth, x2: mouth + 2, z1: Math.min(-2, ...lots.map((p) => p.z1)), z2: Math.max(2, ...lots.map((p) => p.z2)) }
      const road = { name, suburb: city, deadEnd, x1: east ? 0 : -end, x2: east ? end : 0, z1: -2, z2: 2, dirt: j >= 8 }
      roads.push(spine, road)
      const parts = [...lots, spine, road]
      const x1 = Math.min(...parts.map((p) => p.x1)),
        x2 = Math.max(...parts.map((p) => p.x2))
      blocks.push({ parts, x1, z1: spine.z1, width: x2 - x1, height: spine.z2 - spine.z1, target: places[city] })
    }
  }
  const { size, positions } = packStreets(blocks)
  for (const [i, block] of blocks.entries()) {
    const [x, z, turn] = positions[i]
    for (const p of block.parts) {
      if (turn) {
        const { x1, x2, z1, z2 } = p
        Object.assign(p, { x1: block.x1 + block.height - (z2 - block.z1), x2: block.x1 + block.height - (z1 - block.z1), z1: block.z1 + x1 - block.x1, z2: block.z1 + x2 - block.x1 })
        if ('door' in p) p.door = ({ n: 'w', w: 's', s: 'e', e: 'n' } as const)[p.door]
      }
      p.x1 += x - block.x1
      p.x2 += x - block.x1
      p.z1 += z - block.z1
      p.z2 += z - block.z1
    }
  }
  for (const p of parcels) {
    p.y1 = Math.round(terrace((p.x1 + p.x2) / 2, (p.z1 + p.z2) / 2, opts.reroll, true))
    p.y2 += p.y1
  }
  if (roads.length) roads[0].maskSize = size
  const spawn: [number, number] = roads.length ? [Math.floor((roads[0].x1 + roads[0].x2) / 2), Math.floor((roads[0].z1 + roads[0].z2) / 2)] : [0, 0]
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
