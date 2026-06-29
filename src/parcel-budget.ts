import { FeatureType } from '../common/messages/feature'
import type Feature from './features/feature'
import type Parcel from './parcel'

type Template = {
  type: FeatureType
  children?: Template[]
}

type BudgetLimits = Readonly<Partial<Record<FeatureType, number>>>

export const featureBudget: BudgetLimits = {
  audio: 80,
  button: 50,
  sign: 100,
  image: 500,
  'nft-image': 200,
  'collectible-model': 100,
  'vox-model': 500,
  cube: 1000,
  megavox: 5,
  lantern: 20,
  boombox: 4,
  'guest-book': 1,
  'poap-dispenser': 1,
  'pose-ball': 10,
  'spawn-point': 1,
  'text-input': 20,
  'slider-input': 20,
  'polytext-v2': 6,
  polytext: 6,
  portal: 15,
  richtext: 10,
  video: 40,
  'vid-screen': 5,
  youtube: 50,
  showbox: 10,
  particles: 4,
  group: 1000,
}

export const minimalBudget: BudgetLimits = {
  audio: 80,
  sign: 100,
  image: 500,
  'nft-image': 200,
  'collectible-model': 100,
  'vox-model': 500,
  megavox: 20,
  video: 40,
  particles: 20,
  group: 1000,
}

// To test minimalism
const crvox = /0xa253D7cd38dC2D0B2E65AD42a7e4bEB3C60A83aD/i

export default class ParcelBudget {
  features: { type: FeatureType }[]
  parcel: Parcel

  constructor(parcel: Parcel) {
    this.features = []
    this.parcel = parcel
  }

  // hard limit
  static budget(type: FeatureType, parcel?: Parcel): number {
    const space = parcel?.spaceId
    let limits = featureBudget

    if (parcel && space && parcel.owner.match(crvox)) {
      limits = minimalBudget
    }

    return limits[type] ?? 0
  }

  count(type: FeatureType) {
    let sum = this.features.filter((f) => f.type === type).length
    if (type == 'polytext') {
      sum += this.features.filter((f) => f.type === 'polytext-v2').length
    }
    if (type == 'polytext-v2') {
      sum += this.features.filter((f) => f.type === 'polytext').length
    }
    return sum
  }

  remaining(type: FeatureType) {
    return ParcelBudget.budget(type, this.parcel) - this.count(type)
  }

  hasBudgetForFeature(featureTemplate: Template | Feature): { pass: boolean; types: { type: FeatureType; pass: boolean }[] } {
    const result: { pass: boolean; types: { type: FeatureType; pass: boolean }[] } = { pass: true, types: [] }
    if (!featureTemplate) {
      return { pass: false, types: [] }
    }
    const countByType = countFeatureTypes(featureTemplate)
    const types = Object.keys(countByType) as FeatureType[]

    for (const type of types) {
      if (!this.hasBudgetFor(type, countByType[type])) {
        // that feature type does not pass the budget check
        result.types.push({ type, pass: false })
        result.pass = false
      } else {
        // that feature type passes the budget check
        result.types.push({ type, pass: true })
      }
    }

    return result
  }

  hasBudgetFor(type: FeatureType, count = 1) {
    if (this.count(type) + count <= ParcelBudget.budget(type, this.parcel)) {
      return true
    }
  }

  consume(feature: { type: FeatureType }): boolean {
    const result = this.hasBudgetFor(feature.type)
    if (!result) {
      return false
    }
    this.features.push({ type: feature.type })
    return result
  }

  unconsume(feature: { type: FeatureType }) {
    const index = this.features.findIndex((f) => f.type === feature.type)
    if (index >= 0) {
      this.features.splice(index, 1)
    }
  }

  reset() {
    this.features = []
  }
}

export const countFeatureTypes = (featureTemplate: Template): Partial<Record<FeatureType, number>> => {
  const countByType: Partial<Record<FeatureType, number>> = {}

  const count = (featureTemplate: Template) => {
    const t = featureTemplate.type
    countByType[t] = (countByType[t] ?? 0) + 1

    if (featureTemplate.children) {
      featureTemplate.children.forEach((featureTemplate) => count(featureTemplate))
    }
  }

  count(featureTemplate)
  return countByType
}
