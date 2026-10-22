import type { ParcelMeta } from '../../../common/types'
import { getBlockId } from '../../../common/content/blocks'

export type Face = 'n' | 's' | 'e' | 'w'

export type VillageParcel = ParcelMeta & {
  address: string
  door: Face
  material: number
}

// area is the average lot in m2, height the average building in metres, each with its own lognormal spread
export type VillageOpts = { name: string; streets: string[]; count: number; reroll: number; area: number; areaSpread: number; height: number; heightSpread: number }

type Rect = { x1: number; z1: number; x2: number; z2: number }
type Street = { alongX: boolean; at: number; name: string }
type Lot = { r: Rect; street: Street; door: Face }

// mulberry32
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const snap = (v: number) => Math.round(v / 2) * 2

// Village: the named streets cross the island as 4m bands, tiny lots pack along both sides of them, then more
// lots cluster off the backs and sides of those, higgledy piggledy. One ground floor building per lot with its
// door on the street. Same name + reroll gives the same village. Numbered along each street, odd one side even the other.
export function village({ name, streets, count, reroll, area, areaSpread, height, heightSpread }: VillageOpts) {
  let hash = reroll * 7919
  for (const c of name) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0
  const rand = seeded(hash)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  // lognormal, minus half the variance so the mean stays put as spread goes up
  const vary = (mean: number, spread: number) => mean * Math.exp(spread * gauss() - (spread * spread) / 2)

  // room for the count at this lot size, doubled for streets, gaps and the ragged edge
  const total = count * area * 2.2
  const w = snap(Math.sqrt(total * (1 + rand() * 0.6)))
  const d = snap(total / w)

  // streets alternate direction so they cross, and keep 16m off each other
  const list: Street[] = []
  for (const [i, n] of (streets.length ? streets : [name]).entries()) {
    const alongX = i % 2 === 0
    const span = alongX ? d : w
    for (let tries = 0; tries < 20; tries++) {
      const at = snap(-span / 2 + 8 + rand() * (span - 20))
      if (list.every((s) => s.alongX !== alongX || Math.abs(s.at - at) >= 16)) {
        list.push({ alongX, at, name: n })
        break
      }
    }
  }

  // nothing may overlap a street, another lot, or hang off the island
  const blocks: Rect[] = list.map((s) => (s.alongX ? { x1: -w / 2, z1: s.at, x2: w / 2, z2: s.at + 4 } : { x1: s.at, z1: -d / 2, x2: s.at + 4, z2: d / 2 }))
  const blocked = (r: Rect) => r.x1 < -w / 2 || r.z1 < -d / 2 || r.x2 > w / 2 || r.z2 > d / 2 || blocks.some((b) => r.x1 < b.x2 && r.x2 > b.x1 && r.z1 < b.z2 && r.z2 > b.z1)

  const lots: Lot[] = []
  const place = (r: Rect, street: Street, door: Face) => {
    if (lots.length >= count || blocked(r)) return false
    lots.push({ r, street, door })
    blocks.push(r)
    return true
  }

  // a lot: random area, a bit squarer or longer, nothing under 3m a side
  const lot = () => {
    const a = vary(area, areaSpread)
    const lw = Math.max(3, Math.round(Math.sqrt(a * (0.6 + rand() * 0.8))))
    return [lw, Math.max(3, Math.round(a / lw))]
  }

  // frontage: a cursor walks each side of each street, round robin so every street gets a share, up to 60% of the count
  const cursors = list.flatMap((s) => [0, 1].map((side) => ({ s, side, t: (s.alongX ? -w / 2 : -d / 2) + snap(rand() * 6) })))
  const frontage = Math.ceil(count * 0.6)
  while (lots.length < frontage && cursors.length) {
    for (const c of [...cursors]) {
      if (lots.length >= frontage) break
      const { s, side, t } = c
      const [lw, ld] = lot()
      const end = s.alongX ? w / 2 : d / 2
      if (t + lw > end) {
        cursors.splice(cursors.indexOf(c), 1)
        continue
      }
      // frontage lw along the street, ld deep away from it, door facing it
      let r: Rect
      let door: Face
      if (s.alongX) {
        r = side ? { x1: t, x2: t + lw, z1: s.at + 4, z2: s.at + 4 + ld } : { x1: t, x2: t + lw, z1: s.at - ld, z2: s.at }
        door = side ? 's' : 'n'
      } else {
        r = side ? { z1: t, z2: t + lw, x1: s.at + 4, x2: s.at + 4 + ld } : { z1: t, z2: t + lw, x1: s.at - ld, x2: s.at }
        door = side ? 'w' : 'e'
      }
      // mostly touching the neighbour, sometimes a 1m gap, and bump along 1m past anything in the way
      c.t += place(r, s, door) ? lw + (rand() < 0.3 ? 1 : 0) : 1
    }
  }

  // infill: stick a lot on a random side of a random lot, overlapping the shared edge by at least 2m, door facing it
  for (let tries = 0; lots.length < count && tries < count * 50 && lots.length; tries++) {
    const p = lots[Math.floor(rand() * lots.length)]
    const [lw, ld] = lot()
    const side = Math.floor(rand() * 4)
    const pw = p.r.x2 - p.r.x1
    const pd = p.r.z2 - p.r.z1
    let r: Rect
    if (side < 2) {
      const x1 = Math.round(p.r.x1 - lw + 2 + rand() * (pw + lw - 4))
      r = side ? { x1, x2: x1 + lw, z1: p.r.z1 - ld, z2: p.r.z1 } : { x1, x2: x1 + lw, z1: p.r.z2, z2: p.r.z2 + ld }
    } else {
      const z1 = Math.round(p.r.z1 - lw + 2 + rand() * (pd + lw - 4))
      r = side === 2 ? { z1, z2: z1 + lw, x1: p.r.x2, x2: p.r.x2 + ld } : { z1, z2: z1 + lw, x1: p.r.x1 - ld, x2: p.r.x1 }
    }
    place(r, p.street, (['s', 'n', 'w', 'e'] as Face[])[side])
  }

  // numbered along the street, odd on the low side even on the high side
  const numbers = new Map<Lot, string>()
  for (const s of list) {
    const along = (l: Lot) => (s.alongX ? l.r.x1 + l.r.x2 : l.r.z1 + l.r.z2)
    const next = [1, 2]
    for (const l of lots.filter((l) => l.street === s).sort((a, b) => along(a) - along(b))) {
      const side = (s.alongX ? l.r.z2 : l.r.x2) <= s.at ? 0 : 1
      numbers.set(l, `${next[side]} ${s.name}`)
      next[side] += 2
    }
  }

  const parcels: VillageParcel[] = lots.map((l) => ({
    id: 0,
    address: numbers.get(l) || `${lots.indexOf(l) + 1} ${name}`,
    x1: l.r.x1,
    y1: 0,
    z1: l.r.z1,
    x2: l.r.x2,
    // one metre of that is the ground
    y2: Math.max(4, Math.round(vary(height, heightSpread)) + 1),
    z2: l.r.z2,
    door: l.door,
    // wall tiles of the atlas, untinted so a colour atlas shows as painted
    material: getBlockId([2, 4, 5, 6, 8, 9, 14][Math.floor(rand() * 7)], 0),
  }))

  // stand in the middle of the first street
  const s = list[0]
  const spawn: [number, number] = s ? (s.alongX ? [0, s.at + 2] : [s.at + 2, 0]) : [0, 0]
  return { parcels, spawn }
}
