import ndarray, { NdArray } from 'ndarray'
import { v7 as uuid } from 'uuid'
import zlib from 'zlib'
import { defaultColors, getBlockId } from '../common/content/blocks'
import ParcelHelper from '../common/helpers/parcel-helper'
import { ParcelContentRecord } from '../common/messages/parcel'
import Parcel from './parcel'

export const empty = 0
export const ground = (1 << 15) + 1
export const glass = 2
export const white = (1 << 15) + 3

const GROUND_HEIGHT = 1

type FillCallback = (x: number, y: number, z: number, width: number, height: number, depth: number) => number

export default class ParcelBuilder {
  parcel: Parcel
  field: NdArray<Uint16Array>
  features: Array<any>

  constructor(parcel: any) {
    this.parcel = parcel
    this.field = ndarray(new Uint16Array(this.width * this.height * this.depth), this.resolution)
    this.features = []
  }

  destroy() {
    delete (this as any).field.data
    delete (this as any).field
    delete (this as any).features
    delete (this as any).parcel
  }

  fill(yStart: number, yMax: number, cb: FillCallback) {
    const width = this.width
    const height = yMax - yStart
    const depth = this.depth

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        for (let z = 0; z < depth; z++) {
          const value = cb(x, y, z, width, height, depth)
          this.field.set(x, y + yStart, z, value)
        }
      }
    }
  }

  fillBasement(cb: FillCallback) {
    this.fill(0, this.basementHeight, cb)
  }

  fillAboveGround(cb: FillCallback) {
    this.fill(this.basementHeight, this.height, cb)
  }

  get voxelSize() {
    return 0.5
  }

  get width() {
    return (this.parcel.x2 - this.parcel.x1) / this.voxelSize
  }

  get height() {
    return this.parcel.height / this.voxelSize
  }

  get basementHeight() {
    // units don't have a basement
    return this.parcel.y1 <= 0 ? (GROUND_HEIGHT - this.parcel.y1) / this.voxelSize : 1
  }

  get aboveGroundHeight() {
    return this.height - this.basementHeight
  }

  get depth() {
    return (this.parcel.z2 - this.parcel.z1) / this.voxelSize
  }

  get resolution() {
    return [this.width, this.height, this.depth]
  }

  get voxels() {
    const buffer = Buffer.from(this.field.data.buffer)
    const deflated = zlib.deflateSync(buffer)
    return deflated.toString('base64')
  }

  get serialize() {
    const result = { voxels: this.voxels, features: this.features.map((f) => f.serialize()) } as ParcelContentRecord
    this.destroy()
    return result
  }

  static Empty(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return material || ground
    })

    b.fillAboveGround(() => {
      return empty
    })

    return b.serialize
  }

  // Three randomly sized towers
  static ThreeTowers(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    const genTower = () => {
      return {
        x1: Math.floor((Math.random() * b.width) / 2),
        x2: Math.floor((Math.random() * b.width) / 2 + b.width / 2),
        y1: 0,
        y2: Math.floor((Math.random() / 2 + 0.4) * b.aboveGroundHeight),
        z1: Math.floor((Math.random() * b.depth) / 2),
        z2: Math.floor((Math.random() * b.depth) / 2 + b.depth / 2),
      }
    }

    const towers = [genTower(), genTower(), genTower()]

    b.fillBasement(() => {
      return ground
    })

    b.fillAboveGround((x, y, z, width, height, depth) => {
      let result = empty

      towers.forEach((t) => {
        if (y <= t.y2 && ((x === t.x1 && z === t.z1) || (x === t.x2 && z === t.z1) || (x === t.x1 && z === t.z2) || (x === t.x2 && z === t.z2))) {
          result = material
        } else if (y === t.y2 && x >= t.x1 && x <= t.x2 && z >= t.z1 && z <= t.z2 && (x === t.x1 || x === t.x2 || z === t.z1 || z === t.z2)) {
          result = material
        }
      })

      if (y === 0 && (x === 0 || z === 0 || x === width - 1 || z === depth - 1)) {
        result = material
      }

      return result
    })

    return b.serialize
  }

  // An outline around the build area
  static Outline(parcel: any, material: any, groundMaterial: any = ground) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return groundMaterial
    })

    b.fillAboveGround((x, y, z, width, height, depth) => {
      if ((x === 0 && z === 0) || (x === width - 1 && z == 0) || (x === 0 && z == depth - 1) || (x === width - 1 && z === depth - 1)) {
        return material
      } else if (y === height - 1 && (x === 0 || z === 0 || x === width - 1 || z === depth - 1)) {
        return material
      } else if (y === 0 && (x === 0 || z === 0 || x === width - 1 || z === depth - 1)) {
        return material
      } else {
        return 0
      }
    })

    return b.serialize
  }

  static OnlyBottomBorder(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return ground
    })

    b.fillAboveGround((x, y, z, width, height, depth) => {
      if (y === 0 && (x === 0 || z === 0 || x === width - 1 || z === depth - 1)) {
        return material
      } else {
        return 0
      }
    })

    return b.serialize
  }

  static House(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return ground
    })

    b.fillAboveGround((x, y, z, width, height, depth) => {
      const door = y <= 4 && (Math.abs(x - width / 2) < 2 || Math.abs(z - depth / 2) < 2)
      const skylight = Math.abs(x - width / 2) < 4 && Math.abs(z - depth / 2) < 4

      if ((x === 0 || x === width - 1 || z === 0 || z === depth - 1) && !door) {
        return material
      } else if (y === height - 1 && !skylight) {
        return material
      } else {
        return 0
      }
    })

    return b.serialize
  }

  static Pyramid(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return ground
    })

    b.fillAboveGround((x, y, z, width, height, depth) => {
      const door = y <= 4 && (Math.abs(x - width / 2) < 2 || Math.abs(z - depth / 2) < 2)

      const delta = Math.min(width, depth, height) - y

      if (Math.abs(x - width / 2) < delta && Math.abs(z - depth / 2) < delta && !door) {
        return material
      } else {
        return 0
      }
    })

    return b.serialize
  }

  static Scaffold(parcel: any, material: any) {
    const b = new ParcelBuilder(parcel)

    b.fillBasement(() => {
      return ground
    })

    const w = Math.floor(b.width / 5) * 5 - 2
    const d = Math.floor(b.depth / 5) * 5 - 2

    b.fillAboveGround((x, y, z, width, height) => {
      const grid = (x + 1) % 5 === 0 || (y + 2) % 5 === 0 || (z + 1) % 5 === 0
      const maxY = height - 1

      if (x <= w && z <= d && y === maxY && ((x + 1) % 5 === 0 || (z + 1) % 5 === 0)) {
        return material
      } else if (x <= w && z <= d && (x === 0 || x === w || z === 0 || z === d) && grid) {
        return material
      } else {
        return 0
      }
    })

    return b.serialize
  }

  static Park(parcel: any, material: any) {
    const content = ParcelBuilder.Empty(parcel, material)

    content.features = generateParcelFeatures(parcel, 'Park').features
    const palette = parcel.content?.palette || (defaultColors as string[])
    palette[0] = '#25803e' // set first tint = Green
    content.palette = palette

    return content
  }

  // Shells for web/src/admin/kowloon.ts. Spiral stair round an 8x8 ring in the low corner, each floor holes its
  // slab over the top of the stair below. Ground plots there are 12m, so y1 === 12 means the floor below is a plot.
  // ground floor village house: walls with little windows, a 2m door on the street face, flat roof
  static Village(parcel: any, material: number, door: string) {
    const b = new ParcelBuilder(parcel)
    b.fillBasement(() => ground)
    b.fillAboveGround((x, y, z, width, height, depth) => {
      if (y === height - 1) return material
      const face = x === 0 ? 'w' : x === width - 1 ? 'e' : z === 0 ? 's' : z === depth - 1 ? 'n' : null
      if (!face) return empty
      const along = face === 'w' || face === 'e' ? z : x
      const mid = (face === 'w' || face === 'e' ? depth : width) / 2
      if (face === door && y < 5 && Math.abs(along + 0.5 - mid) < 2) return empty
      return y % 6 >= 2 && y % 6 <= 4 && along % 6 >= 2 && along % 6 <= 3 ? glass : material
    })

    // one to three lanterns hung inside, each its own hue so the village glows rainbow at night
    const w = parcel.x2 - parcel.x1
    const d = parcel.z2 - parcel.z1
    const h = parcel.height - GROUND_HEIGHT
    const lanterns = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
      uuid: uuid(),
      type: 'lantern',
      scale: [0.5, 0.5, 0.5],
      rotation: [0, 0, 0],
      position: [(Math.random() - 0.5) * (w - 2), 2 + Math.random() * Math.max(0, h - 3), (Math.random() - 0.5) * (d - 2)],
      color: rainbow(Math.random()),
    }))
    return { ...b.serialize, features: lanterns }
  }

  get dummyFeatures(): any {
    return [
      // { type: 'sign', text: 'hi2u', position: [-2, 2, 0], scale: [1, 1, 1], rotation: [0, 0, 0] },
      // { type: 'webview', url: '...', position: [2, 2.25, 0.25], scale: [1.5, 2, 1], rotation: [0, 0, 0] }
    ]
  }
}

// full saturation hue to hex, the lantern material only reads hex
function rainbow(hue: number) {
  const f = (n: number) => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((hue * 6 + n) % 6) - 3) - 1)))
  return '#' + [f(0), f(4), f(2)].map((c) => c.toString(16).padStart(2, '0')).join('')
}

export function generateParcelFeatures(parcel: Parcel, func: string) {
  const helper = new ParcelHelper(parcel)
  const width = helper.width
  const depth = helper.depth

  const roundedRandom = (max = 1) => Math.floor(Math.random() * max)
  const shouldHaveFeature = (likelihood = 0.5) => {
    return Math.random() <= likelihood
  }

  const randomPositionWithinParcel_onGround = () => {
    const nudge = 0.5 // nudge to make sure features are not too far outside the parcel
    let x = Math.random() * width - width / 2
    x = x > 4 ? x - nudge : x < -4 ? x + nudge : x //minimum parcel size is 4.
    let z = Math.random() * depth - depth / 2
    z = z > 4 ? z - nudge : z < -4 ? z + nudge : z //minimum parcel size is 4.
    const y = parcel.y1 < 0 ? Math.abs(parcel.y1) + 0.75 : 0.75
    return [x, y, z]
  }

  const randomYRotation = () => {
    return [0, Math.random() * (2 * Math.PI), 0]
  }

  const randomScale = (featureScale: number[], factor = 1.5) => {
    const maxScaleFactor = 0.9 + roundedRandom(factor)
    return featureScale.map((n) => n * maxScaleFactor)
  }

  const generatePark = () => {
    const features = []

    const generateTrees = () => {
      const trees = []
      for (let i = 0; i < 9; i++) {
        if (!shouldHaveFeature()) continue

        const f = { uuid: uuid(), position: [], ...featuresFromLibrary.trees[roundedRandom(featuresFromLibrary.trees.length)] } as BasicFeatureRecord

        f.position = randomPositionWithinParcel_onGround()
        f.rotation = randomYRotation()
        f.scale = randomScale(f.scale)
        trees.push(f)
      }
      return trees
    }

    const generateGrass = () => {
      const grasses = []
      for (let i = 0; i < 6; i++) {
        if (!shouldHaveFeature()) continue

        const f = { uuid: uuid(), position: [], ...featuresFromLibrary.grass[roundedRandom(featuresFromLibrary.grass.length)] } as BasicFeatureRecord

        f.position = randomPositionWithinParcel_onGround()
        f.scale = randomScale(f.scale, 1.3)
        f.rotation = randomYRotation()
        grasses.push(f)
      }
      return grasses
    }

    const generateBench = () => {
      if (!shouldHaveFeature()) return []

      const bench = featuresFromLibrary.benches[0] as BasicFeatureRecord
      bench.uuid = uuid()
      bench.position = randomPositionWithinParcel_onGround()
      bench.rotation = randomYRotation()
      return [bench]
    }
    features.push(...generateTrees(), ...generateGrass(), ...generateBench())

    return features
  }

  const result = { features: [] } as any

  if (func == 'Park') {
    result.features = generatePark()
  }

  return result
}
type BasicFeatureRecord = { uuid: string; position: number[]; scale: number[]; rotation?: number[]; url: string; type: string }
// The next lines are dedicated to a small library of
// hand picked features that are good looking vox models so we can use them for the "build..." tab
const featuresFromLibrary = {
  trees: [
    { /* normal green tree*/ url: 'https://wiki.cryptovoxels.com/tall_tree.vox', scale: [2, 2, 2], type: 'vox-model' },
    { /* Pink sakura tree */ url: 'https://media-crvox.sfo2.digitaloceanspaces.com/0xb7d3a787a39f25457ca511dc3f0591b546f5e02f/1642108820578-3a8ce93a-4ea0-4944-a84b-65946e204d64.vox', type: 'vox-model', scale: [3, 3, 3] },
    { /* Olive tree */ url: 'https://media-crvox.sfo2.digitaloceanspaces.com/0x2717a5086b3b4c91f4761f9d5f8eaca3594f4ca0/1641855679121-9a4e6ba5-6a07-4de0-b01e-888a7becdfb4.vox', type: 'vox-model', scale: [2.6, 3.5, 2.6] },
    { /* Pine tree */ url: 'https://media-crvox.sfo2.digitaloceanspaces.com/0xb7d3a787a39f25457ca511dc3f0591b546f5e02f/1642108400305-0c2925c6-8db4-4680-a074-7cfb491fbaf7.vox', type: 'vox-model', scale: [6, 6, 6] },
    { /* Pine tree */ url: 'https://media-crvox.sfo2.digitaloceanspaces.com/0xbb4b3932ab84d1c2c5fbcd70abbee6c991c9a168/1642107570633-6330072c-3d71-4e75-873e-364fd35d7875.vox', type: 'vox-model', scale: [6, 6, 6] },
  ],
  grass: [
    { /*Simple tall grass*/ url: 'https://wiki.cryptovoxels.com/tall_grass.vox', type: 'vox-model', scale: [2, 3, 2] },
    { /* Bush-like*/ url: 'https://media-crvox.sfo2.digitaloceanspaces.com/0x7b511800a8d8e7de24dd19de3103081824b6f41d/1642541637191-c95ab7ad-24de-4d9f-b2db-097b2ac6c18f.vox', type: 'vox-model', scale: [1.1, 1, 0.8] },
  ],
  benches: [{ url: 'https://wiki.cryptovoxels.com/wooden_bench.vox', type: 'vox-model', scale: [2.5, 2.2, 2] }],
}
