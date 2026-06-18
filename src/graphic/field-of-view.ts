import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import { isMobile } from '../../common/helpers/detector'

const getSavedFOV = (): number | null => {
  if (typeof localStorage === 'undefined') return null
  const stored = localStorage.getItem('fov')

  if (!stored) return null

  const parsed = parseFloat(stored)

  return isNaN(parsed) ? null : parsed
}

const saveFOV = (fov: number) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem('fov', fov.toString())
}

export const WIDE_FOV = Math.PI / 2
export const NORMAL_FOV = 1.2

export class FOV extends TypedEventTarget<{ changed: { value: number } }> {
  private fov: number = getSavedFOV() ?? (isMobile() ? WIDE_FOV : NORMAL_FOV) // wide by default on mobile, normal on desktop

  constructor() {
    super()
  }

  public get value() {
    return this.fov
  }

  public set value(value: number) {
    if (value === this.fov) return
    this.fov = value
    // todo max/min clamp?

    saveFOV(value)

    this.dispatchEvent(createEvent('changed', { value }))
  }
}
