import { packGround } from '../../common/voxels/ground-bytes'
import { entrances } from '../../islands/texas/parcels/entrances'
import { mesaEdge } from '../../islands/texas/parcels/mesa'
import { bankSteps } from '../../islands/texas/banks'
import { plantWind } from '../../islands/texas/nature'
import { furniture } from '../../islands/texas/furniture'
import pack from '../../islands/texas/artpack.json'
import { v5 as uuid } from 'uuid'
import ndarray, { type NdArray } from 'ndarray'
import { getVoxelsFromBuffer } from '../../common/voxels/helpers'
import { texas, terrace, creekBeds, type Road } from '../../islands/texas/layout'
import { village, type VillageOpts } from '../../web/src/admin/village'

export function islandLayout(opts: VillageOpts) {
  return opts.name.trim().toLowerCase() === 'texas' ? texas(opts) : village(opts)
}

export function islandSurface(parcels: (Road & { y1?: number; suburb?: string })[], roads: Road[], artpack: string, center: vec2, reroll: number) {
  const land = [...parcels, ...roads]
  const { bounds, field } = getIslandField(land, true)
  const texas = !!parcels[0]?.suburb
  const surface = artpack || texas ? groundMap(field, bounds[0], bounds[1], ...center, roads, reroll, parcels, texas, artpack) : undefined
  const [x1, z1, x2, z2] = bounds
  const geometry = getIslandGeometry(field, [center[0] + (x1 + x2) / 200, center[1] + (z1 + z2) / 200])
  const water = getIslandGeometry(field, [center[0] + (x1 + x2) / 200, center[1] + (z1 + z2) / 200], 2)
  const lakes = { type: 'MultiPolygon', coordinates: water.coordinates.map((ring) => [ring]) }
  return {
    geometry,
    ground: surface?.ground,
    lakes,
    content: {
      origin: [center[0] * 100, 0, center[1] * 100],
      features: surface?.features || [],
      ...(artpack === 'texas-thrift' && { furnitureVersion: 6 }),
      streets: roads.filter((r) => r.name),
      ...(!surface && { voxels: getVoxelsFromBuffer(getIslandField(parcels).field.data) }),
      ...(artpack && { artpack }),
    },
  }
}

// Four little-endian int32s (world x, z, cell width, depth), then sixteen 50cm layers.
// Within a layer x runs fastest. 255 is air; other bytes index the artpack's 8x8 atlas.
function groundMap(field: NdArray<Uint16Array>, x: number, z: number, cx: number, cz: number, roads: Road[], seed: number, parcels: (Road & { y1?: number; common?: string; door?: string })[], texas: boolean, artpack: string) {
  const [w, , h] = field.shape
  const width = w * 2,
    depth = h * 2,
    plane = width * depth
  const bytes = new Uint8Array(16 + plane * 16).fill(255)
  const head = new DataView(bytes.buffer)
  ;[Math.round(cx * 100) + x, Math.round(cz * 100) + z, width, depth].forEach((v, i) => head.setInt32(i * 4, v, true))
  const types = new Uint8Array(w * h)
  for (const r of roads) {
    for (let j = r.z1 - z; j < r.z2 - z; j++) {
      for (let i = r.x1 - x; i < r.x2 - x; i++) types[i + j * w] = r.dirt ? 2 : 1
    }
  }
  const pads = new Uint8Array(w * h)
  for (const p of parcels) {
    for (let j = p.z1 - z; j < p.z2 - z; j++) pads.fill(4 + 2 * (p.y1 || 0), j * w + p.x1 - x, j * w + p.x2 - x)
  }
  const beds = texas ? creekBeds(roads, x, w, seed) : []
  const shrubs: any[] = []
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = i + j * w
      let hash = Math.imul(i + x + seed, 73856093) ^ Math.imul(j + z, 19349663)
      hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0
      let tile = 255
      if (types[k]) {
        const mask = Number(!!types[k - w]) + 2 * Number(!!types[k + 1]) + 4 * Number(!!types[k + w]) + 8 * Number(!!types[k - 1])
        tile = types[k] * 16 + mask
        if (types[k] === 1 && mask === 15) {
          const cut = Number(!types[k - w - 1]) + 2 * Number(!types[k - w + 1]) + 4 * Number(!types[k + w + 1]) + 8 * Number(!types[k + w - 1])
          if (cut || hash % 83 === 0) tile = 48 + cut
        }
      } else if (field.get(i, 1, j)) {
        const patch = Math.imul((i >> 3) + seed, 13) ^ Math.imul(j >> 3, 7)
        tile = (patch & 7) + (hash % 11 === 0 ? 8 : 0)
      }
      if (tile === 255) continue
      const wx = x + i,
        wz = z + j
      const height = pads[k] || 4 + (texas ? 2 * terrace(wx, wz, seed, !!types[k]) : 0)
      const channel = texas && !pads[k] && beds[i].some((bed, j) => Math.abs(wz - bed) < (j === 0 ? 3.5 : 2.25))
      if (channel) field.set(i, 2, j, 1)
      if (texas && artpack === 'texas-thrift' && !channel && !pads[k] && !types[k] && hash % 7 === 0 && beds[i].some((bed, n) => Math.abs(wz - bed) < (n ? 3.65 : 4.9))) {
        const plant = (hash >>> 8) % 12
        const name = pack.flora[plant < 8 ? plant % 2 : plant < 10 ? 14 : 2 + (plant % 2)]
        const scale = 1.1 + (hash % 19) / 15
        const yaw = ((hash % 16) * Math.PI) / 8
        shrubs.push({
          uuid: uuid('texas/bank/' + [seed, wx, wz].join('/'), uuid.URL),
          type: 'vox-model',
          animation: plantWind(name),
          url: pack.frames.path + name + '.vox',
          position: [wx + 0.5 - 0.08 * scale * Math.cos(yaw), height * 0.5 - 1.26, wz + 0.5 + 0.08 * scale * Math.sin(yaw)],
          rotation: [0, yaw, 0],
          scale: [scale, scale, scale],
        })
      }
      for (let y = 0; y < height; y++) {
        // Leave open water under the road deck where a street crosses the creek.
        if (channel && y >= 2 && !(types[k] && y === height - 1)) continue
        const material = channel && y === 1 ? 5 : y === height - 1 ? tile : y < 3 ? 3 : 4
        const at = 16 + y * plane + j * 2 * width + i * 2
        bytes[at] = bytes[at + 1] = bytes[at + width] = bytes[at + width + 1] = material
      }
    }
  }
  if (artpack === 'texas-thrift') {
    if (texas) shrubs.push(...bankSteps(field, x, z, pads, types, seed, (px, pz) => 4 + 2 * terrace(px, pz, seed, false)))
    for (const p of parcels) {
      if (p.common !== 'mesa') continue
      const pw = 2 * (p.x2 - p.x1),
        pd = 2 * (p.z2 - p.z1)
      const origin = 16 + (3 + 2 * (p.y1 ?? 0)) * plane + 2 * (p.z1 - z) * width + 2 * (p.x1 - x)
      for (let j = 0; j < pd; j++)
        for (let i = 0; i < pw; i++) {
          const edge = mesaEdge((i + 0.5) / pw, p.door === 'n' ? (j + 0.5) / pd : 1 - (j + 0.5) / pd)
          const tint = Math.min(7, Math.round((1.34 - edge) * 18))
          const at = origin + j * width + i
          if (tint > 0 && bytes[at] < 16) bytes[at] = 72 + 8 * tint + (bytes[at] % 8)
        }
    }
    // Narrow exposed road edges by one half-cell. Shared edges at junctions stay paved.
    function top(i: number, j: number, tile: number) {
      if (i < 0 || j < 0 || i >= width || j >= depth || !types[(i >> 1) + (j >> 1) * w]) return
      for (let at = 16 + 15 * plane + j * width + i; at >= 16; at -= plane) {
        if (bytes[at] === 255) continue
        bytes[at] = tile
        return
      }
    }
    for (let j = 1; j < h - 1; j++)
      for (let i = 1; i < w - 1; i++) {
        const k = i + j * w
        if (!types[k]) continue
        for (let d = 0; d < 2; d++) {
          if (!types[k - w]) top(i * 2 + d, j * 2, 1)
          if (!types[k + w]) top(i * 2 + d, j * 2 + 1, 1)
          if (!types[k - 1]) top(i * 2, j * 2 + d, 1)
          if (!types[k + 1]) top(i * 2 + 1, j * 2 + d, 1)
        }
      }
    entrances(parcels, cx, cz, (px, pz, tile) => top(px - x * 2, pz - z * 2, tile))
  }
  const features =
    artpack === 'texas-thrift'
      ? furniture(
          roads,
          [cx, cz],
          seed,
          (px, pz) => {
            const i = Math.floor((px - x) * 2),
              j = Math.floor((pz - z) * 2)
            if (i >= 0 && i < width && j >= 0 && j < depth)
              for (let layer = 15; layer >= 0; layer--) {
                const tile = bytes[16 + layer * plane + j * width + i]
                if (tile !== 255) return { tile, y: (layer + 1) * 0.5 - 1.26 }
              }
            return { tile: -1, y: 0 }
          },
          parcels,
        )
      : []
  return { ground: packGround(bytes), features: features.concat(shrubs) }
}

const PAVEMENT_LEVEL = 1
const BLEED_MARGIN = 2

// Outline of the solid cells of the island field as square cornered rings: every solid cell edge that
// has water on the other side, chained into loops. Outer rings only, courtyards fill in. Geo coords.
function getIslandGeometry(field: IslandField, center: vec2, level = PAVEMENT_LEVEL) {
  const width = field.shape[0]
  const depth = field.shape[2]
  const solid = (x: number, z: number) => x >= 0 && z >= 0 && x < width && z < depth && field.get(x, level, z) !== 0

  // edges run anticlockwise round the solid, keyed by their start corner
  const next = new Map<string, [number, number]>()
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if (!solid(x, z)) continue
      if (!solid(x, z - 1)) next.set(`${x},${z}`, [x + 1, z])
      if (!solid(x + 1, z)) next.set(`${x + 1},${z}`, [x + 1, z + 1])
      if (!solid(x, z + 1)) next.set(`${x + 1},${z + 1}`, [x, z + 1])
      if (!solid(x - 1, z)) next.set(`${x},${z + 1}`, [x, z])
    }
  }

  const rings: [number, number][][] = []
  while (next.size) {
    const start = next.keys().next().value!
    const ring: [number, number][] = []
    let at = start
    let area = 0
    while (next.has(at)) {
      const [x, z] = at.split(',').map(Number)
      const to = next.get(at)!
      next.delete(at)
      area += x * to[1] - to[0] * z
      // drop corners that only continue a straight edge
      const prev = ring[ring.length - 1]
      const before = ring[ring.length - 2]
      if (prev && before && ((before[0] === prev[0] && prev[0] === x) || (before[1] === prev[1] && prev[1] === z))) ring.pop()
      ring.push([x, z])
      at = `${to[0]},${to[1]}`
    }
    // the loop only trims corners mid ring, so check the join back to the start too
    const straight = (a: [number, number], b: [number, number], c: [number, number]) => (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])
    while (ring.length > 3 && straight(ring[ring.length - 2], ring[ring.length - 1], ring[0])) ring.pop()
    while (ring.length > 3 && straight(ring[ring.length - 1], ring[0], ring[1])) ring.shift()
    if (area > 0) rings.push(ring)
  }

  const offsetX = center[0] - width / 200
  const offsetZ = center[1] - depth / 200
  return { type: 'Polygon', coordinates: rings.map((r) => [...r, r[0]].map(([x, z]) => [x / 100 + offsetX, z / 100 + offsetZ])) }
}

type vec2 = [number, number]
type vec4 = [number, number, number, number]

type IslandField = NdArray<Uint16Array>

function getIslandField(parcels: Road[], hull = false): { bounds: vec4; field: IslandField } {
  if (parcels.length === 0) {
    throw new Error('No parcels provided')
  }

  const margin = BLEED_MARGIN
  // const splatMargin = 4

  let minX = Infinity,
    maxX = -Infinity
  let minZ = Infinity,
    maxZ = -Infinity

  for (const p of parcels) {
    minX = Math.min(minX, p.x1)
    maxX = Math.max(maxX, p.x2)
    minZ = Math.min(minZ, p.z1)
    maxZ = Math.max(maxZ, p.z2)
  }

  // Grow bounds by 1 unit in all directions
  minX -= 1 + margin
  maxX += 1 + margin
  minZ -= 1 + margin
  maxZ += 1 + margin

  const bounds: vec4 = [minX, minZ, maxX, maxZ]

  const w = maxX - minX
  const h = 4
  const d = maxZ - minZ

  const solid = (1 << 15) + 0
  const border = (1 << 15) + 4

  const field = ndarray(new Uint16Array(w * h * d), [w, h, d])

  // Painting each expanded lot covers the same cells as splatting every occupied metre.
  function paint(radius: number, value: number) {
    for (const p of parcels) {
      for (let x = p.x1 - minX - radius; x < p.x2 - minX + radius; x++) {
        for (let z = p.z1 - minZ - radius; z < p.z2 - minZ + radius; z++) {
          field.set(x, PAVEMENT_LEVEL, z, value)
        }
      }
    }
  }

  paint(margin, solid)
  paint(1, border)

  // Flood fill from edges
  const queue: [number, number][] = []

  queue.push([0, 0])

  while (queue.length > 0) {
    const [x, z] = queue.pop()!
    if (x < 0 || x >= w || z < 0 || z >= d) continue
    if (field.get(x, PAVEMENT_LEVEL, z) !== 0) continue

    field.set(x, PAVEMENT_LEVEL, z, 2) // mark as water-accessible

    queue.push([x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1])
  }

  // All remaining 0s are enclosed: mark them as ground (1)
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 0) {
        field.set(x, PAVEMENT_LEVEL, z, solid)
      }
    }
  }

  // Null out parcels
  if (!hull) paint(0, 0)

  // Delete the ocean
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if (field.get(x, PAVEMENT_LEVEL, z) === 2) {
        field.set(x, PAVEMENT_LEVEL, z, 0)
      }
    }
  }

  return { bounds, field }
}
