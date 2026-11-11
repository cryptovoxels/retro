import pack from '../artpack.json'
import { thriftModel } from '../models'
import type ParcelBuilder from '../../../server/parcel-builder'
import { getBlockId } from '../../../common/content/blocks'
import { buildingStyle, doorCell } from './entrances'
import { interiors } from './interiors'
import { windowWall } from './windows'
import { batwing } from './doors'
import { Animations } from '../../../src/avatar-animations'
import { camp } from './camp'
import { mesa } from './mesa'
import { v7 as uuid } from 'uuid'

export function buildTexas(b: ParcelBuilder, material: number, face: string, index: number, common?: 'mesa' | 'campfire') {
  if (common === 'mesa') return mesa(b, face, index)
  if (common === 'campfire') return camp(b, face, index)
  const style = buildingStyle(b.parcel.x1, b.parcel.z1)
  const side = face === 'e' || face === 'w'
  const width = side ? b.depth : b.width
  const depth = side ? b.width : b.depth
  const h = b.height - 2
  const mid = Math.floor(width / 2)
  const features: any[] = []
  const yaw = (({ n: 0, e: 1, s: 2, w: -1 }[face] || 0) * Math.PI) / 2
  const tile = (material & 31) - 1
  const finish = pack.frames.tiles.includes(tile) ? tile : 9
  const brick = getBlockId(4, 0),
    wood = getBlockId(6, 0),
    cream = getBlockId(13, 0),
    roof = getBlockId(15, 0)
  // u runs along the facade, v runs inward. Models use the parcel centre as origin.
  function feature(u: number, y: number, v: number, record: any) {
    const a = (u - width / 2) / 2,
      d = (depth / 2 - v) / 2
    features.push({ uuid: uuid(), position: [0.25 + a * Math.cos(yaw) + d * Math.sin(yaw), y, 0.25 + d * Math.cos(yaw) - a * Math.sin(yaw)], rotation: [0, yaw, 0], ...record })
  }
  function trim(kind: string, u: number, y: number, v: number, timber = false, angle = 0) {
    // Imported trim is centred 4 model voxels along local X (4.5 for the odd-width viga).
    // At scale 5 each is 0.1 m, and facade coordinates are in half-metres.
    const pivot = (kind === 'viga' ? 4.5 : 4) * 0.2
    feature(u - pivot * Math.cos(angle), y, v - pivot * Math.sin(angle), {
      type: 'vox-model',
      rotation: [0, yaw + angle, 0],
      url: pack.frames.path + kind + '-' + (timber ? 'honey' : finish) + '.vox',
      scale: [5, kind === 'door' ? 2.5 / (26 * 0.02) : 5, 5],
    })
  }
  const home = style === 'homer' || style === 'ned'
  const porch = style === 'saloon' || style === 'mall'
  const front = porch ? Math.min(4, depth - 4) : 1
  const door = doorCell(style, width)
  const eave = Math.max(4, h - 1 - Math.min(4, Math.floor(h / 3)))
  b.fill(0, 2, () => (style === 'town square' ? cream : getBlockId(0, 0)))
  b.fill(2, b.height, (x, y, z) => {
    const u = face === 'e' ? b.depth - 1 - z : face === 'w' ? z : face === 's' ? b.width - 1 - x : x
    const v = face === 'e' ? b.width - 1 - x : face === 'w' ? x : face === 's' ? z : b.depth - 1 - z
    const edge = u === 0 || u === width - 1
    if (style === 'town square') {
      if (v === depth - 1 && !edge && y < 7) return wood | windowWall
      const radius = Math.max(Math.abs(u - mid), Math.abs(v - Math.floor(depth / 2)))
      if (radius === 2 && y === 0) return material
      if (radius < 2 && y === 0) return getBlockId(8, 0)
      return radius === 0 && y < 4 ? cream : 0
    }
    if (home) {
      const garage = style === 'homer' && u > width * 0.58
      const rise = garage ? 0 : style === 'ned' ? Math.min(u, width - 1 - u) : Math.min(v, depth - 1 - v)
      const top = Math.min(h - 1, (garage ? Math.min(eave, 6) : eave) + rise)
      if (style === 'ned' && u >= width - 4 && u <= width - 3 && v >= depth - 4 && v <= depth - 3 && y >= top) return brick
      if (y > top) return 0
      if (y === top && v >= front - 1) return roof
      if (garage && v === front && !edge && y < top - 1) return y % 2 ? cream : wood
    } else if (porch && v < front) {
      if (y === 5 || (style === 'saloon' && y === 7 && v === 0)) return wood
      if (v === 0 && (edge || (style === 'mall' && u % 7 === 0)) && y < 5) return wood
      return 0
    } else if (style === 'record shop' && v === 0 && y >= 5) {
      const radius = Math.min(4, (h - 5) / 2),
        r = Math.hypot(u - mid, y - 5 - radius)
      if (r <= radius) return r < 1.25 ? brick : roof
    } else if (style === 'thrift store' && v === 0 && y === 5) return u % 4 < 2 ? cream : material
    else if (style === 'cinema' && v === 0 && (y === 5 || (y === 6 && !edge))) return cream
    if (v < front) return 0
    if (!home && y === h - 1) return style === 'saloon' && v === front ? wood : material
    if (!(edge || v === depth - 1 || v === front)) return 0
    if (v === front && !edge) {
      if (style === 'saloon' && y >= h - 3 && Math.abs(u - mid) < width / 3) return wood
      if (style === 'kwik-e-mart' && (y === h - 3 || y === h - 2)) return y === h - 3 ? brick : getBlockId(8, 0)
      if (Math.abs(u - door + 0.5) < 2 && y < 5) return 0
      if (style === 'mall' && y < 5 && u % 7 !== 0) return 0
      if (style === 'mall' && y < 5) return wood
      if (Math.abs(u - door + 0.5) < 3 && y < 6) return material
    }
    return edge && (v === front || v === depth - 1) ? material : material | windowWall
  })
  interiors(b, face, front, style === 'town square', finish, yaw, feature)
  if (style === 'saloon' || style === 'thrift store') {
    for (const dir of [1, -1]) {
      const angle = yaw + (dir === 1 ? 0 : Math.PI)
      feature(door - dir * 1.94, 1.08, front + 0.45, {
        type: 'vox-model',
        url: pack.interiors.door,
        rotation: [0, angle, 0],
        scale: [2.5, 2.5, 2.5],
        isTrigger: dir === 1,
        proximityToTrigger: 3.2,
        interactHint: 'open',
        behave: [{ name: 'batwing', link: 'front doors', code: batwing(dir, Math.round((angle * 180) / Math.PI)) }],
      })
    }
  }
  if (style !== 'town square') {
    if (index % 7 === 2 && width >= 9) {
      feature(2.4, Math.min(3.8, (h - 2) / 2 + 0.65), front - 0.2, { type: 'vox-model', url: pack.interiors.flag, scale: [2.8, 2.8, 2.8], rotation: [0, yaw - Math.PI / 2, 0], animation: 'flag' })
    }
    if ((home || porch || style === 'adobo') && index % 4 === 1 && width >= 12) {
      feature(door < mid ? width - 3 : 2.6, 0.75, porch ? 1.85 : front + 3.1, {
        type: 'vox-model',
        url: pack.interiors.rocker,
        scale: [2.2, 2.2, 2.2],
        animation: { destination: 'rotation', easing: { function: 'Sine', mode: 'Start + End' }, keyframes: [-1, 1, -1].map((dir, i) => ({ frame: i * 61, value: [dir * 0.072, yaw, 0] })) },
        pose: { animation: Animations.Sitting, offset: [0.198, 0.528, 0] },
      })
    }
    if (style !== 'mall') trim('door', door, 0.75, front)
    if (style === 'mall') {
      for (let u = 3; u < width - 1; u += 7) trim('window', u, 1, 0, true)
    } else if (style === 'adobo') {
      for (let u = 2; u + 1 < width - 1; u += 6) trim('viga', u + 1, 0.75 + (h - 2) / 2, front)
    }
    if (style === 'record shop' || style === 'cinema' || style === 'kwik-e-mart' || style === 'thrift store')
      feature(mid, (h - 1) / 2 + 0.6, front - 0.2, { type: 'sign', text: { 'record shop': '33 RPM', cinema: 'PICTURE SHOW', 'kwik-e-mart': 'KWIK-E-MART', 'thrift store': 'SECOND HAND' }[style], scale: [2, 2, 2] })
    const v = (front + depth) / 2
    const u = width / 2
    const x = Math.floor(side ? (face === 'e' ? b.width - v : v) : u)
    const z = Math.floor(side ? b.depth / 2 : face === 'n' ? b.depth - v : v)
    let ceiling = 3
    while (ceiling < b.height - 1 && !b.field.get(x, ceiling, z)) ceiling++
    const bottom = ceiling * 0.5 - 0.25 - 1.2
    feature(u - 0.32, bottom, v, { type: 'vox-model', url: pack.interiors.pendant, scale: [2, 2, 2] })
    feature(u, bottom + 0.15, v, { type: 'lantern', color: '#fff1d7', scale: [0.22, 0.22, 0.22] })
  }
  if (index % 2 === 0) {
    const rooftop = index % 4 === 0 && !home && style !== 'town square'
    const size = Math.min(rooftop ? 3 : 1.5, width / 2 - 1, depth / 2 - 1)
    const pos = [style === 'town square' ? -Math.min(2, b.width / 4 - 0.5) : 0, rooftop ? b.parcel.height - 0.25 : 1, 0]
    features.push({ uuid: uuid(), ...thriftModel(index / 2, pos, size) })
  }
  return { ...b.serialize, features, building: style }
}
