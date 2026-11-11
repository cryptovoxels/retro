import { onLand } from '../islands/texas/shape'
import { buildingStyle } from '../islands/texas/parcels/entrances'
import { furniture } from '../islands/texas/furniture'
import { expect, it } from 'vitest'
import { unpackGround } from '../common/voxels/ground-bytes'
import { groundMesh } from '../src/monoworker/ground-mesh'
import { islandLayout, islandSurface } from '../src/monoworker/island'
import ParcelBuilder from '../server/parcel-builder'
import { inflateSync } from 'node:zlib'

const settings = { name: 'Texas', streets: [], count: 736, reroll: 0, area: 60, areaSpread: 0.4, height: 8, heightSpread: 0.3 }

it('keeps every address on its street and every parcel off the roads', () => {
  for (const reroll of [0, 1, 9]) {
    const { parcels, roads } = islandLayout({ ...settings, reroll })
    expect(parcels).toHaveLength(736)
    const size = Number('maskSize' in roads[0] && roads[0].maskSize)
    expect(size).toBeLessThan(500)
    for (const rect of [...parcels, ...roads]) {
      for (let z = rect.z1; z < rect.z2; z++) for (let x = rect.x1; x < rect.x2; x++) if (!onLand(x + 0.5, z + 0.5, size)) throw Error('offshore at ' + [x, z])
    }
    for (const p of parcels) expect(parcels.some((q) => p !== q && q.x1 < p.x2 && q.x2 > p.x1 && q.z1 < p.z2 && q.z2 > p.z1)).toBe(false)
    const parks = parcels.filter((p) => p.is_common)
    expect(parks).toHaveLength(10)
    for (const park of parks) {
      expect(parcels.some((p) => p !== park && p.x1 < park.x2 && p.x2 > park.x1 && p.z1 < park.z2 && p.z2 > park.z1)).toBe(false)
      if (park.common === 'mesa') {
        expect(park.x2 - park.x1).toBeGreaterThanOrEqual(16)
        expect(park.z2 - park.z1).toBeGreaterThanOrEqual(16)
      }
    }
    expect(new Set(parcels.map((p) => p.y1)).size).toBeGreaterThan(2)
    expect(parcels.slice(0, 8).map((p) => p.address.split(' ')[0])).toEqual(['1', '3', '4', '6', '8', '9', '11', '12'])
    const ends = roads.filter((r) => 'deadEnd' in r && r.deadEnd)
    expect(ends.length).toBeGreaterThanOrEqual(33)
    for (const road of ends) {
      expect(
        parcels.some(
          (p) =>
            (p.z1 < road.z2 && p.z2 > road.z1 && ((p.door === 'w' && p.x1 === road.x2) || (p.door === 'e' && p.x2 === road.x1))) ||
            (p.x1 < road.x2 && p.x2 > road.x1 && ((p.door === 's' && p.z1 === road.z2) || (p.door === 'n' && p.z2 === road.z1))),
        ),
      ).toBe(true)
    }
    expect(new Set(parcels.map((p) => p.suburb)).size).toBe(10)
    expect(new Set(parcels.map((p) => p.address.replace(/^\d+ /, ''))).size).toBe(100)
    expect(new Set(parcels.map((p) => p.address)).size).toBe(736)
    for (const p of parcels) {
      expect(Number.isInteger(p.y1)).toBe(true)
      expect(roads.some((r) => r.x1 < p.x2 && r.x2 > p.x1 && r.z1 < p.z2 && r.z2 > p.z1)).toBe(false)
    }
  }
})

it('fits both VOX frames around the actual glass on every rotated adobo facade', () => {
  const p = islandLayout(settings).parcels.find((p) => !p.is_common && buildingStyle(p.x1, p.z1) === 'adobo')!
  for (const face of ['n', 's', 'e', 'w']) {
    const parcel = { ...p, height: p.y2 - p.y1 }
    const building = ParcelBuilder.Village(parcel, p.material, face, true)
    const glass = inflateSync(Buffer.from(building.voxels!, 'base64'))
    const frames = building.features.filter((f: any) => f.url?.includes('/window-')) as any[]
    const depth = (p.z2 - p.z1) * 2,
      width = (p.x2 - p.x1) * 2
    expect(frames.length % 2).toBe(0)
    expect(new Set(frames.map((f) => f.scale.join('/'))).size).toBeGreaterThan(1)
    const covered = new Set<number>()
    for (let i = 0; i < frames.length; i += 2) {
      const a = frames[i],
        b = frames[i + 1],
        yaw = a.rotation[1]
      const [sx, sy] = a.scale
      const w = Math.round(sx * 0.4),
        h = Math.round(sy * 0.6)
      const cx = (a.position[0] + b.position[0]) / 2 + 0.08 * sx * Math.cos(yaw)
      const cz = (a.position[2] + b.position[2]) / 2 - 0.08 * sx * Math.sin(yaw)
      expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeCloseTo(0.58)
      for (let column = 0; column < w; column++)
        for (let row = 0; row < h; row++) {
          const along = (column + 0.5 - w / 2) * 0.5
          const x = Math.floor((cx + along * Math.cos(yaw) - 0.25) * 2 + width / 2)
          const z = Math.floor((cz - along * Math.sin(yaw) - 0.25) * 2 + depth / 2)
          const y = Math.round((a.position[1] + 0.04 * sy - 0.75) * 2) + 2 + row
          const index = (x * parcel.height * 2 + y) * depth + z
          expect(glass.readUInt16LE(index * 2) & 31).toBe(2)
          covered.add(index)
        }
    }
    let count = 0
    for (let i = 0; i < glass.length; i += 2) if ((glass.readUInt16LE(i) & 31) === 2) count++
    expect(covered.size).toBe(count)
  }
})

it('indexes the spawn road by world metre after a draft reload', () => {
  const { parcels, roads, spawn } = islandLayout(settings)
  const surface = islandSurface(parcels, roads, 'texas-thrift', [-0.51, -10.07], 0)
  const bytes = Buffer.from(unpackGround(surface.ground!))
  const x = bytes.readInt32LE(0),
    z = bytes.readInt32LE(4),
    w = bytes.readInt32LE(8),
    h = bytes.readInt32LE(12)
  expect(bytes.length).toBe(w * h * 16 + 16)
  const k = (-1007 + spawn[1] - z) * 2 * w + (-51 + spawn[0] - x) * 2
  const column = Array.from({ length: 16 }, (_, y) => bytes[16 + y * w * h + k]).filter((v) => v !== 255)
  expect(column[column.length - 1]).toBeGreaterThanOrEqual(16)
  expect(column[column.length - 1]).toBeLessThan(64)
  expect(surface.lakes.coordinates.length).toBeGreaterThan(3)
  expect(new Set(surface.content.streets.map((r) => r.name)).size).toBe(100)
  expect(surface.content.features.length).toBeGreaterThan(300)
  for (const p of parcels) {
    const pad = 2 * (p.x1 - 51 - x) + 2 * (p.z1 - 1007 - z) * w
    const top = 3 + p.y1 * 2
    expect(bytes[16 + top * w * h + pad]).not.toBe(255)
    if (top < 15) expect(bytes[16 + (top + 1) * w * h + pad]).toBe(255)
  }
  const geo = groundMesh(bytes)
  expect(geo.positions.length / 3).toBe(geo.uvs.length / 2)
  expect(geo.indices.length).toBeGreaterThan(0)
  expect(bytes[16]).toBe(255)
  expect(islandLayout(settings).parcels).toEqual(parcels)
})

it('keeps all ten building styles in the Texas draft with adobos most common', () => {
  const { parcels } = islandLayout(settings)
  const counts = new Map<string, number>()
  for (const p of parcels) {
    const style = buildingStyle(p.x1 - 51, p.z1 - 1007)
    counts.set(style, (counts.get(style) || 0) + 1)
  }
  expect(counts.size).toBe(10)
  expect(counts.get('adobo')).toBe(Math.max(...counts.values()))
  expect(counts.get('town square')!).toBeLessThan(counts.get('adobo')! / 4)
})

it('relaxes curb furniture deterministically, keeping hydrants away from potholes and the crossing open', () => {
  const roads = [
    { x1: -2, x2: 2, z1: -30, z2: 30 },
    { x1: 2, x2: 30, z1: -2, z2: 2 },
  ]
  const solve = (tile: number) => furniture(roads, [0, 0], 1, () => ({ tile, y: 4 }), [])
  const paved = solve(31)
  expect(solve(31)).toEqual(paved)
  expect(paved.some((f) => f.url?.endsWith('/hydrant.vox'))).toBe(true)
  expect(solve(48).some((f) => f.url?.endsWith('/hydrant.vox'))).toBe(false)
  const lights = paved.filter((f) => f.type === 'lantern')
  expect(lights.length).toBeGreaterThan(0)
  expect(paved.every((f) => f.type === 'lantern' || f.type === 'vox-model')).toBe(true)
  expect(paved.filter((f) => f.url?.endsWith('/lamp-post.vox'))).toHaveLength(lights.length)
  for (const f of paved) {
    expect(Math.max(Math.abs(f.position[0]), Math.abs(f.position[2]))).toBeGreaterThan(3)
    expect(f.position[1]).toBeGreaterThanOrEqual(4)
  }
})

it('gives the saved Texas seed 10 to 30 ArtFrames per building and leaves the parks open', () => {
  const { parcels } = islandLayout(settings)
  for (const [i, p] of parcels.entries()) {
    const b = ParcelBuilder.Village({ ...p, x1: p.x1 - 51, x2: p.x2 - 51, z1: p.z1 - 1007, z2: p.z2 - 1007, height: p.y2 - p.y1 }, p.material, p.door, true, i)
    const frames = b.features.filter((f) => f.type === 'nft-image')
    if (p.is_common) {
      expect(frames).toHaveLength(0)
      continue
    }
    expect(frames.length, p.address).toBeGreaterThanOrEqual(10)
    expect(frames.length, p.address).toBeLessThanOrEqual(30)
    expect(new Set(frames.map((f) => String(f.scale))).size).toBeGreaterThan(1)
  }
})
