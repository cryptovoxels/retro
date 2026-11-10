import { buildingStyle } from '../islands/texas/buildings'
import { furniture } from '../islands/texas/furniture'
import { expect, it } from 'vitest'
import { unpackGround } from '../common/voxels/ground-bytes'
import { groundMesh } from '../src/monoworker/ground-mesh'
import { islandLayout, islandSurface } from '../src/monoworker/island'

const settings = { name: 'Texas', streets: [], count: 736, reroll: 0, area: 60, areaSpread: 0.4, height: 8, heightSpread: 0.3 }

it('keeps every address on its street and every parcel off the roads', () => {
  for (const reroll of [0, 1, 9]) {
    const { parcels, roads } = islandLayout({ ...settings, reroll })
    expect(parcels).toHaveLength(736)
    expect(new Set(parcels.map((p) => p.y1)).size).toBeGreaterThan(2)
    expect(parcels.slice(0, 8).map((p) => p.address.split(' ')[0])).toEqual(['1', '3', '4', '6', '8', '9', '11', '12'])
    const ends = roads.filter((r) => 'deadEnd' in r && r.deadEnd)
    expect(ends.length).toBeGreaterThanOrEqual(33)
    for (const road of ends) {
      expect(parcels.some((p) => p.z1 < road.z2 && p.z2 > road.z1 && ((p.door === 'w' && p.x1 === road.x2) || (p.door === 'e' && p.x2 === road.x1)))).toBe(true)
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
  expect(paved.some((f) => f.color === '#cb4635')).toBe(true)
  expect(solve(48).some((f) => f.color === '#cb4635')).toBe(false)
  expect(paved.some((f) => f.type === 'lantern')).toBe(true)
  for (const f of paved) {
    expect(Math.max(Math.abs(f.position[0]), Math.abs(f.position[2]))).toBeGreaterThan(3)
    expect(f.position[1]).toBeGreaterThanOrEqual(4)
  }
})
