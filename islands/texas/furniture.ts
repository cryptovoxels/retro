import { seeded } from '../../common/helpers/utils'
import { v5 as uuid } from 'uuid'
import type { Road } from './layout'
import { thriftModel, modelExtent } from './models'

type Kind = 'lamp' | 'hydrant' | 'art' | 'bench'
type Spot = { x: number; z: number; yaw: number; corner: boolean; kind?: Kind }
type Surface = (x: number, z: number) => { tile: number; y: number }

export function furniture(roads: Road[], center: number[], seed: number, ground: Surface, parcels: (Road & { door?: string })[]) {
  const rand = seeded(seed + 736)
  const spots: Spot[] = []
  const vertical = roads.filter((r) => r.z2 - r.z1 > r.x2 - r.x1)
  const doors = parcels.filter((p) => p.door).map((p) => [p.door === 'w' ? p.x1 : p.door === 'e' ? p.x2 : (p.x1 + p.x2) / 2, p.door === 's' ? p.z1 : p.door === 'n' ? p.z2 : (p.z1 + p.z2) / 2])
  // Work outward from each spine crossing. Leave the mouth of the street open.
  for (const r of roads) {
    const spine = vertical.includes(r)
    const crossings = roads.filter((q) => vertical.includes(q) !== spine && q.x1 <= r.x2 && q.x2 >= r.x1 && q.z1 <= r.z2 && q.z2 >= r.z1)
    if (!crossings.length) continue
    for (let t = (spine ? r.z1 : r.x1) + 2; t < (spine ? r.z2 : r.x2) - 1; t += 3) {
      const distance = Math.min(...crossings.map((q) => Math.abs(t - (spine ? q.z1 + q.z2 : q.x1 + q.x2) / 2)))
      if (distance < 3.5) continue
      for (const side of [-1, 1]) {
        const x = spine ? (side < 0 ? r.x1 + 0.65 : r.x2 - 0.65) : t
        const z = spine ? t : side < 0 ? r.z1 + 0.65 : r.z2 - 0.65
        if (doors.some(([dx, dz]) => Math.hypot(x - dx, z - dz) < 2) || ground(x, z).tile < 16) continue
        spots.push({ x, z, corner: distance < 12, yaw: (spine ? Math.PI / 2 : 0) + (side < 0 ? 0 : Math.PI) })
      }
    }
  }
  const nearby = spots.map((p) => spots.filter((q) => q !== p && Math.abs(p.x - q.x) < 22 && Math.abs(p.z - q.z) < 22).map((q) => ({ q, d: Math.hypot(p.x - q.x, p.z - q.z) })))
  const kinds: Kind[] = ['lamp', 'hydrant', 'bench', 'art']
  // Coordinate descent: remove this slot, score the empty slot and its four uses, then replace it.
  for (let pass = 0; pass < 5; pass++) {
    const start = Math.floor(rand() * Math.max(1, spots.length))
    for (let j = 0; j < spots.length; j++) {
      const i = (start + j) % spots.length,
        p = spots[i],
        neighbors = nearby[i]
      p.kind = undefined
      let best = 0
      for (const kind of kinds) {
        if (kind === 'hydrant' && (!p.corner || [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => ground(p.x + dx, p.z + dz).tile === 48)))) continue
        let score = { lamp: 5, hydrant: 3, bench: 2, art: 1.7 }[kind] + rand() * 0.8 + (p.corner ? 1 : 0)
        for (const { q, d } of neighbors) {
          if (!q.kind) continue
          if (d < 3.2) score -= 8
          if (q.kind === kind) score -= Math.max(0, 1 - d / { lamp: 19, hydrant: 22, bench: 13, art: 10 }[kind]) * 10
          else if (kind === 'bench' && q.kind === 'lamp' && d < 6) score += 1
        }
        if (score > best) {
          best = score
          p.kind = kind
        }
      }
    }
  }
  const features: any[] = []
  for (const p of spots) {
    if (!p.kind) continue
    const { x, z, yaw } = p,
      y = ground(x, z).y
    const add = (record: any) => features.push({ uuid: uuid([center, seed, x, z, p.kind, features.length].join('/'), uuid.URL), rotation: [0, yaw, 0], ...record })
    const cube = (dy: number, scale: number[], color: string, dz = 0) => add({ type: 'cube', position: [x + dz * Math.sin(yaw), y + dy, z + dz * Math.cos(yaw)], scale, color })
    if (p.kind === 'lamp') {
      cube(1.8, [0.22, 3.6, 0.22], '#50404a')
      add({ type: 'lantern', position: [x, y + 3.85, z], scale: [0.85, 0.85, 0.85], color: '#ffce86' })
    } else if (p.kind === 'hydrant') {
      cube(0.46, [0.4, 0.92, 0.4], '#cb4635')
      cube(0.54, [0.82, 0.23, 0.26], '#cf6342')
      cube(0.95, [0.49, 0.14, 0.49], '#edb763')
    } else if (p.kind === 'bench') {
      cube(0.24, [1.7, 0.48, 0.33], '#58483c')
      cube(0.5, [1.95, 0.16, 0.62], '#b26a44')
      cube(0.79, [1.95, 0.5, 0.13], '#925136', -0.25)
    } else {
      const model = thriftModel(Math.floor(rand() * 256), [x, y, z], 1)
      // VOX imports stand on their pivot. One model voxel is 2cm at unit scale.
      const scale = (1.2 + rand() * 0.4) / (0.02 * modelExtent(model.url))
      add({ ...model, rotation: [0, yaw, 0], scale: [scale, scale, scale] })
    }
  }
  return features
}
