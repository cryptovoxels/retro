import type { ParcelMeta } from '../../../common/types'
import { getBlockId } from '../../../common/content/blocks'

// Storey grid shared with ParcelBuilder.Kowloon: ground plot 12m, every unit above 8m, so floors line up across towers
const GROUND = 12
const STOREY = 8
const LEVELS = 12

export type Door = [face: 'n' | 's' | 'e' | 'w', at: number]

export type KowloonParcel = ParcelMeta & {
  kind: 'plot' | 'unit' | 'outer'
  doors: Door[]
  top: boolean
  material: number
}

type Lot = { x1: number; z1: number; x2: number; z2: number; levels: KowloonParcel[] }

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

// Dense multilevel island: lots cut by alleys and streets, units stacked on the lots, bridges across the alleys.
// Same name + reroll gives the same island.
export function kowloon(name: string, count: number, reroll: number): KowloonParcel[] {
  let hash = reroll * 7919
  for (const c of name) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0
  const rand = seeded(hash)

  // lots come out smaller than the 24x22 avg Origin footprint, so /5 lands around 4 levels a tower
  const area = Math.ceil(count / 5) * 24 * 22 * 1.35
  const w = snap(Math.sqrt(area * (1 + rand() * 0.6)))
  const d = snap(area / w)

  let lots: Lot[] = []
  const split = (x1: number, z1: number, x2: number, z2: number, depth: number) => {
    const alongX = x2 - x1 >= z2 - z1
    const len = alongX ? x2 - x1 : z2 - z1
    if (x2 - x1 <= 32 && z2 - z1 <= 32) {
      lots.push({ x1, z1, x2, z2, levels: [] })
      return
    }
    // top two cuts are 4m streets, the rest are 2m alleys
    const gap = depth < 2 ? 4 : 2
    const start = alongX ? x1 : z1
    const at = Math.min(Math.max(start + snap(len * (0.35 + rand() * 0.3)), start + 12), start + len - 12 - gap)
    if (alongX) {
      split(x1, z1, at, z2, depth + 1)
      split(at + gap, z1, x2, z2, depth + 1)
    } else {
      split(x1, z1, x2, at, depth + 1)
      split(x1, at + gap, x2, z2, depth + 1)
    }
  }
  split(-w / 2, -d / 2, w / 2, d / 2, 0)

  // spiky skyline: mostly short stuff, a few towers punching way up, loosely biased to the middle
  const maxDist = Math.hypot(w, d) / 2
  const scored = lots.map((l) => ({ l, score: (1 - Math.hypot((l.x1 + l.x2) / 2, (l.z1 + l.z2) / 2) / maxDist) * 0.5 + rand() }))
  scored.sort((a, b) => b.score - a.score)
  lots = scored.slice(0, count).map((s) => s.l)

  const levels = lots.map(() => 1)
  const target = scored.slice(0, count).map((s) => 1 + Math.round(Math.min(s.score / 1.5, 1) ** 3 * (LEVELS - 1)))
  let remaining = count - lots.length
  // fill to target, and if there's parcels left over stretch every target by half so the tall ones stay the spikes
  while (remaining > 0 && levels.some((l) => l < LEVELS)) {
    let grew = false
    for (let i = 0; i < lots.length && remaining > 0; i++) {
      if (levels[i] >= target[i]) continue
      levels[i]++
      remaining--
      grew = true
    }
    if (!grew) target.forEach((t, i) => (target[i] = Math.min(LEVELS, t + Math.ceil(t / 2))))
  }

  const parcels: KowloonParcel[] = []
  lots.forEach((l, i) => {
    const material = getBlockId([4, 5, 6, 9][Math.floor(rand() * 4)], [1, 2][Math.floor(rand() * 2)])
    for (let n = 0; n < levels[i]; n++) {
      const y1 = n === 0 ? 0 : GROUND + (n - 1) * STOREY
      const p: KowloonParcel = {
        id: 0,
        x1: l.x1,
        y1,
        z1: l.z1,
        x2: l.x2,
        y2: n === 0 ? GROUND : y1 + STOREY,
        z2: l.z2,
        kind: n === 0 ? 'plot' : 'unit',
        doors: [],
        top: n === levels[i] - 1,
        material,
      }
      l.levels.push(p)
      parcels.push(p)
    }
  })

  // Bridges across 2m alleys at unit floors both towers reach
  for (const a of lots) {
    for (const b of lots) {
      const alongX = a.x2 + 2 === b.x1
      if (!alongX && a.z2 + 2 !== b.z1) continue
      const o1 = alongX ? Math.max(a.z1, b.z1) : Math.max(a.x1, b.x1)
      const o2 = alongX ? Math.min(a.z2, b.z2) : Math.min(a.x2, b.x2)
      if (o2 - o1 < 4) continue

      let made = 0
      for (let n = 1; n < Math.min(a.levels.length, b.levels.length) && made < 2; n++) {
        if (rand() > 0.3) continue
        made++
        const bw = o2 - o1 >= 8 && rand() < 0.5 ? 4 : 2
        const c1 = o1 + 1 + Math.floor(rand() * (o2 - o1 - 1 - bw))
        const ua = a.levels[n]
        const ub = b.levels[n]
        ua.doors.push(alongX ? ['e', c1 + bw / 2 - a.z1] : ['n', c1 + bw / 2 - a.x1])
        ub.doors.push(alongX ? ['w', c1 + bw / 2 - b.z1] : ['s', c1 + bw / 2 - b.x1])
        parcels.push({
          id: 0,
          x1: alongX ? a.x2 : c1,
          y1: ua.y1,
          z1: alongX ? c1 : a.z2,
          x2: alongX ? b.x1 : c1 + bw,
          y2: ua.y1 + 4,
          z2: alongX ? c1 + bw : b.z1,
          kind: 'outer',
          doors: alongX
            ? [
                ['w', 0],
                ['e', 0],
              ]
            : [
                ['s', 0],
                ['n', 0],
              ],
          top: false,
          material: ua.material,
        })
      }
    }
  }

  return parcels
}
