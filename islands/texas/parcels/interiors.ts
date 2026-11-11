import { getBlockId } from '../../../common/content/blocks'
import { gallery } from './gallery'
import pack from '../artpack.json'
import { seeded } from '../../../common/helpers/utils'
import { windows, windowWall } from './windows'
import type ParcelBuilder from '../../../server/parcel-builder'

type Place = (u: number, y: number, v: number, record: any) => void

export function interiors(b: ParcelBuilder, face: string, front: number, square: boolean, finish: number, yaw: number, place: Place) {
  const side = face === 'e' || face === 'w'
  const width = side ? b.depth : b.width
  const depth = side ? b.width : b.depth
  let counter = width / 2
  const walls: ReturnType<typeof gallery>[] = []
  const choose = seeded(b.parcel.x1 * 8191 + b.parcel.z1 * 337)
  function block(u: number, y: number, v: number, value?: number) {
    const x = face === 'e' ? b.width - 1 - v : face === 'w' ? v : face === 's' ? b.width - 1 - u : u
    const z = face === 'n' ? b.depth - 1 - v : face === 'e' ? b.depth - 1 - u : face === 'w' ? u : v
    if (value !== undefined) b.field.set(x, y + 2, z, value)
    return b.field.get(x, y + 2, z)
  }
  // Half-metre wall coordinates. The normal points from the wall into the room.
  function wall(u: number, v: number, du: number, dv: number, count: number, nu: number, nv: number) {
    const angle = Math.atan2(-nu, nv)
    const rotation = [0, yaw + angle, 0]
    const cell = (i: number, y: number, value?: number) => block(u + du * i, y, v + dv * i, value)
    function hang(along: number, y: number, distance: number, record: any) {
      place(u + 0.5 + du * (along - 0.5) + nu * (0.5 + distance), y, v + 0.5 + dv * (along - 0.5) + nv * (0.5 + distance), { rotation, ...record })
    }
    const height = b.height - 2
    const rand = seeded(Math.imul(b.parcel.x1, 7919) ^ Math.imul(b.parcel.z1, 104729) ^ ((nu + 2 * nv) * 337))
    const panes = windows(count, height, (i, y) => !!(cell(i, y) & windowWall) && !(nv === -1 && i < (square ? Math.ceil(count * 0.55) : 3) && y < 5), rand)
    for (let y = 0; y < height; y++)
      for (let i = 0; i < count; i++) {
        const value = cell(i, y)
        if (value & windowWall) cell(i, y, value & ~windowWall)
      }
    for (const pane of panes) {
      const glass = getBlockId(1, rand() < 0.23 ? 3 + Math.floor(rand() * 5) : 0)
      for (let y = pane.y; y < pane.y + pane.h; y++) for (let x = pane.x; x < pane.x + pane.w; x++) cell(x, y, glass)
      // The VOX has a 10 x 15 clear opening, two-voxel rails and a mirrored X pivot.
      const sx = (pane.w * 0.5) / (0.02 * 10),
        sy = (pane.h * 0.5) / (0.02 * 15)
      const along = pane.x + pane.w / 2 - 0.16 * sx * (du * Math.cos(angle) + dv * Math.sin(angle))
      for (const distance of [0.08, -1.08])
        hang(along, 0.75 + pane.y / 2 - 0.04 * sy, distance, {
          type: 'vox-model',
          url: pack.frames.path + 'window-' + finish + '.vox',
          scale: [sx, sy, 2],
        })
    }
    if (nv === -1) counter = 2.6
    walls.push(
      gallery(
        count * 2,
        Math.min(height * 2 - 2, 17),
        (x, y) => {
          const i = Math.floor(x / 2),
            row = Math.floor(y / 2),
            solid = cell(i, row)
          if (!solid || (solid & 31) === 2 || y < 2 || x === 0 || x === count * 2 - 1) return false
          if (nv === -1 && i < 5 && y < 7) return false // shelf and counter
          const u = (x + 0.5) / 2,
            v = (y + 0.5) / 2
          return !panes.some((p) => u > p.x - p.w * 0.2 - 0.25 && u < p.x + p.w * 1.2 + 0.25 && v > p.y - p.h * 0.14 - 0.25 && v < p.y + p.h * 1.14 + 0.25)
        },
        (x, y, w, h) => hang(x / 2, 0.75 + y * 0.25, 0.055, { type: 'nft-image', url: '', scale: [w * 0.25 - 0.07, h * 0.25 - 0.07, 0] }),
        rand,
      ),
    )
  }
  wall(1, depth - 1, 1, 0, width - 2, 0, -1)
  if (!square) {
    wall(1, front, 1, 0, width - 2, 0, 1)
    for (const u of [0, width - 1]) wall(u, front + 1, 0, 1, depth - front - 2, u ? -1 : 1, 0)
  }
  const target = 10 + Math.floor(choose() * 21)
  const sizes = [
    [8, 5],
    [4, 6],
    [6, 3],
    [3, 4],
    [4, 3],
    [3, 2],
    [2, 3],
    [2, 2],
    [1, 2],
    [2, 1],
    [1, 1],
  ]
  for (let n = 0; n < target; n++) {
    let placed = false
    for (let s = square && n < 10 ? 6 + Math.floor(choose() * 3) : Math.floor(choose() * 5); s < sizes.length && !placed; s++) {
      for (let f = 0; f < walls.length && !placed; f++) {
        const [w, h] = sizes[s]
        placed = walls[(n + f) % walls.length](w, h)
      }
    }
    if (!placed) break
  }
  // A shallow counter against the back wall leaves the middle aisle clear.
  const sx = Math.min(3, ((width - 2) * 0.5) / 0.56)
  counter = Math.max(1 + 0.56 * sx, Math.min(width - 1 - 0.56 * sx, counter))
  place(counter - 0.16 * sx, 0.75, depth - 1.85, { type: 'vox-model', url: pack.interiors.counter, scale: [sx, 2.8, 3], collidable: true })
  // Shelf below the rear artwork, just above the worktop.
  place(counter + 0.32, 1.77, depth - 1.35, { type: 'vox-model', url: pack.interiors.shelf, rotation: [0, yaw + Math.PI, 0], scale: [2, 1.6, 2] })
}
