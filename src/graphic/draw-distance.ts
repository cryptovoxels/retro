import { drawDistanceOverride, isMobile } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { GraphicEngine, GraphicLevels } from './graphic-engine'

const WorldDistances = {
  [GraphicLevels.Low]: 128,
  [GraphicLevels.Medium]: 128,
  [GraphicLevels.High]: 128,
  [GraphicLevels.Ultra]: 256,
} as const

const SpaceDistances = {
  [GraphicLevels.Low]: 128,
  [GraphicLevels.Medium]: 512,
  [GraphicLevels.High]: 512,
  [GraphicLevels.Ultra]: 512, // Bigger for spaces
} as const

// mobile has ~1GB memory budget; fewer loaded parcels = less likely to get killed by iOS
const MOBILE_MAX_DRAW_DISTANCE = 80

const getDistanceForGraphicsLevel = (level: GraphicLevels, isSpace: boolean): number => {
  // allow users to override the draw distance via query params
  const override = drawDistanceOverride()
  if (override !== null) {
    return override
  }

  const distances = isSpace ? SpaceDistances : WorldDistances
  if (!distances[level]) {
    console.warn(`Unknown graphics level ${level}, defaulting to medium`)
    return distances[GraphicLevels.Medium]
  }

  const distance = distances[level]
  if (isMobile()) return Math.min(distance, MOBILE_MAX_DRAW_DISTANCE)
  return distance
}

export class DrawDistance extends TypedEventTarget<{ 'distance-changed': number }> {
  private readonly _isSpace: boolean

  constructor(graphics: GraphicEngine, isSpace: boolean) {
    super()
    this._isSpace = isSpace
    this._distance = getDistanceForGraphicsLevel(graphics.getSettings().level, this._isSpace)
    graphics.addEventListener('settingsChanged', (event) => {
      this.distance = getDistanceForGraphicsLevel(event.detail.level, this._isSpace)
    })
  }

  private _distance: number

  get distance() {
    return this._distance
  }

  set distance(value) {
    if (this._distance === value) return
    this._distance = value
    this.dispatchEvent(createEvent('distance-changed', value))
  }
}
