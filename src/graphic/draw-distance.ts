import { drawDistanceOverride, isMobile } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { GraphicEngine, GraphicLevels } from './graphic-engine'

const WorldDistances = {
  [GraphicLevels.Low]: 128,
  [GraphicLevels.Medium]: 128,
  [GraphicLevels.High]: 128,
  [GraphicLevels.Ultra]: 256,
  [GraphicLevels.Custom]: 128, // Default for custom, will be overridden
} as const

const SpaceDistances = {
  [GraphicLevels.Low]: 128,
  [GraphicLevels.Medium]: 512,
  [GraphicLevels.High]: 512,
  [GraphicLevels.Ultra]: 512, // Bigger for spaces
  [GraphicLevels.Custom]: 512, // Default for custom, will be overridden
} as const

// mobile has ~1GB memory budget; fewer loaded parcels = less likely to get killed by iOS
const MOBILE_MAX_DRAW_DISTANCE = 80

const getDistanceForGraphicsLevel = (level: GraphicLevels, isSpace: boolean, customDistance?: number): number => {
  // allow users to override the draw distance via query params
  const override = drawDistanceOverride()
  if (override !== null) {
    return override
  }

  // Use custom distance for custom graphics level
  if (level === GraphicLevels.Custom && customDistance !== undefined) {
    return customDistance
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
  private readonly graphics: GraphicEngine

  constructor(graphics: GraphicEngine, isSpace: boolean) {
    super()
    this._isSpace = isSpace
    this.graphics = graphics
    const settings = graphics.getSettings()
    this._distance = getDistanceForGraphicsLevel(settings.level, this._isSpace, settings.customDrawDistance)
    graphics.addEventListener('settingsChanged', (event) => {
      const customDistance = event.detail.level === GraphicLevels.Custom ? this.graphics.customDrawDistance : undefined
      this.distance = getDistanceForGraphicsLevel(event.detail.level, this._isSpace, customDistance)
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
