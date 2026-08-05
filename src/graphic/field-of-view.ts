import { createEvent, TypedEventTarget } from '../utils/EventEmitter'

const FOV_KEY = 'fov2'
const DEFAULT_FOV = (70 * Math.PI) / 180
const MIN_FOV = (30 * Math.PI) / 180
const MAX_FOV = (100 * Math.PI) / 180

const getSavedFOV = (): number | null => {
  if (typeof localStorage === 'undefined') return null
  const stored = localStorage.getItem(FOV_KEY)

  if (!stored) return null

  const parsed = parseFloat(stored)

  return isNaN(parsed) ? null : parsed
}

const saveFOV = (fov: number) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(FOV_KEY, fov.toString())
}

export const WIDE_FOV = Math.PI / 2
export const NORMAL_FOV = 1.2

export class FOV extends TypedEventTarget<{ changed: { value: number } }> {
  private fov: number = clampFov(getSavedFOV() ?? DEFAULT_FOV)

  constructor() {
    super()
  }

  public get value() {
    return this.fov
  }

  public set value(value: number) {
    const next = clampFov(value)
    if (next === this.fov) return
    this.fov = next

    saveFOV(next)

    this.dispatchEvent(createEvent('changed', { value: next }))
  }
}

function clampFov(value: number) {
  return Math.min(MAX_FOV, Math.max(MIN_FOV, value))
}
