// Rebuild the 20m Texas block with: node --import tsx multiplayer/sim/bake.ts
import { writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { islandLayout, islandSurface } from '../../src/monoworker/island'
import { unpackGround } from '../../common/voxels/ground-bytes'
import ParcelBuilder from '../../server/parcel-builder'
import draft from '../../islands/texas/draft.json'

const { parcels, roads } = islandLayout({ ...draft, streets: [] })
const center: [number, number] = [draft.center[0], draft.center[1]]
const terrain = islandSurface(parcels, roads, draft.artpack, center, draft.reroll)
const ground = Buffer.from(unpackGround(terrain.ground!))
const [x0, z0, w, d] = [0, 4, 8, 12].map((i) => ground.readInt32LE(i))
const masks = Buffer.alloc(40 * 40 * 8)
function fill(x: number, y: number, z: number) {
  if (x < 0 || x >= 40 || z < 0 || z >= 40 || y < 0 || y >= 64) return
  const offset = (z * 40 + x) * 8 + (y >>> 5) * 4
  masks.writeUInt32LE((masks.readUInt32LE(offset) | (1 << y)) >>> 0, offset)
}
for (let z = 0; z < 40; z++)
  for (let x = 0; x < 40; x++)
    for (let y = 0; y < 16; y++) {
      const k = (101 - x0) * 2 + x + ((-1068 - z0) * 2 + z) * w
      if (ground[16 + y * w * d + k] !== 255) fill(x, y, z)
    }
parcels.forEach((p, i) => {
  const x1 = Math.round(center[0] * 100) + p.x1,
    z1 = Math.round(center[1] * 100) + p.z1
  const width = 2 * (p.x2 - p.x1),
    depth = 2 * (p.z2 - p.z1),
    height = 2 * (p.y2 - p.y1)
  if (x1 >= 121 || x1 + width / 2 <= 101 || z1 >= -1048 || z1 + depth / 2 <= -1068) return
  const shape = { ...p, x1, x2: x1 + width / 2, z1, z2: z1 + depth / 2, height: height / 2 }
  const house = ParcelBuilder.Village(shape, p.material, p.door, true, i)
  const bytes = inflateSync(Buffer.from(house.voxels!, 'base64'))
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++)
      for (let z = 0; z < depth; z++) {
        if (bytes.readUInt16LE(2 * ((x * height + y) * depth + z)))
          fill(2 * (x1 - 101) + x, 2 * p.y1 + 2 + y, 2 * (z1 + 1068) + z)
      }
})
writeFileSync('multiplayer/sim/block.bin', masks)
