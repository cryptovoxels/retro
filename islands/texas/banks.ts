import { v5 as uuid } from 'uuid'
import type { NdArray } from 'ndarray'
import pack from './artpack.json'
import { rockProp } from './nature'

// Follow consecutive exposed water faces. Each flight starts one stride below
// the bank and finishes one stride above the creek bed, clear of bridge decks.
export function bankSteps(field: NdArray<Uint16Array>, x: number, z: number, pads: Uint8Array, roads: Uint8Array, seed: number, height: (x: number, z: number) => number) {
  const [w, , d] = field.shape
  const rocks = []
  for (const side of [-1, 1])
    for (let j = 1; j < d - 1; j++) {
      let start = 0
      for (let i = 1; i < w; i++) {
        const k = j * w + i,
          shore = k - side * w
        const edge = i < w - 1 && field.get(i, 2, j) && !roads[k] && field.get(i, 1, j - side) && !field.get(i, 2, j - side) && !pads[shore] && !roads[shore]
        if (edge && !start) start = i
        if (!start || (edge && height(x + i, z + j - side) === height(x + start, z + j - side))) continue
        const land = height(x + start, z + j - side) * 0.5 - 1.26,
          bed = -0.26
        const steps = Math.max(2, Math.ceil((land - bed) / 0.3) - 1)
        const length = steps * 0.82
        const bank = z + j + (side < 0 ? 1 : 0)
        for (let run = start; run + length + 0.35 <= i; run += Math.ceil(length) + 9) {
          const hash = (Math.imul(x + run + seed, 73856093) ^ Math.imul(bank, 19349663)) >>> 0
          for (let n = 0; n < steps; n++) {
            const t = (hash % 2 ? n : steps - 1 - n) + 1
            const top = land - ((land - bed) * t) / (steps + 1)
            const thick = Math.min(0.72, top - bed + 0.05)
            const name = pack.rocks[(hash % 4 ? 10 : 0) + ((hash + n * 7) % 10)]
            const prop = rockProp(name, x + run + 0.52 + n * 0.82, top - thick, bank + side * 0.41, 0, 1, [1.03, thick, 1.37])
            rocks.push({ uuid: uuid('texas/step/' + [seed, run, j, side, n].join('/'), uuid.URL), ...prop })
          }
        }
        start = edge ? i : 0
      }
    }
  return rocks
}
