import { isBatterySaver, isMobile, wantsXR } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import type { PostProcesses } from './post-processes'

export enum GraphicLevels {
  Low = 0,
  Medium = 1,
  High = 2,
  Ultra = 3,
  Custom = 4,
}

export interface GraphicSettings {
  level: GraphicLevels
  realisticLighting?: boolean
  // Custom preset granular controls
  customDrawDistance?: number
  customWaterQuality?: 'simple' | 'reflection'
  customGlowEffects?: boolean
  customAntiAliasing?: number
  customSharpening?: boolean
  customMaxActiveParcels?: number
  customFog?: boolean
}

export class GraphicEngine extends TypedEventTarget<{
  settingsChanged: { level: GraphicLevels; customSettings?: Partial<GraphicSettings> }
}> {
  private readonly engine: BABYLON.Engine
  #level: GraphicLevels
  #customDrawDistance: number
  #customWaterQuality: 'simple' | 'reflection'
  #customGlowEffects: boolean
  #customAntiAliasing: number
  #customSharpening: boolean
  #customMaxActiveParcels: number
  #customFog: boolean
  #realisticLighting: boolean
  public postProcesses?: PostProcesses

  constructor(engine: BABYLON.Engine) {
    super()
    this.engine = engine

    // Default to ultra low graphics level until we're confident we can increase the quality
    this.#level = GraphicLevels.Medium

    // Custom settings defaults (matching Medium graphics level)
    this.#customDrawDistance = 128
    this.#customWaterQuality = 'reflection'
    this.#customGlowEffects = true
    this.#customAntiAliasing = 2
    this.#customSharpening = true
    this.#customMaxActiveParcels = 11
    this.#customFog = true
    this.#realisticLighting = false
  }

  get level() {
    return this.#level
  }

  get customDrawDistance() {
    return this.#customDrawDistance
  }

  get customWaterQuality() {
    if (isBatterySaver()) {
      return 'simple'
    }

    return this.#customWaterQuality
  }

  get customGlowEffects() {
    return this.#customGlowEffects
  }

  get customAntiAliasing() {
    return this.#customAntiAliasing
  }

  get customSharpening() {
    return this.#customSharpening
  }

  get customMaxActiveParcels() {
    return this.#customMaxActiveParcels
  }

  get customFog() {
    return this.#customFog
  }

  get realisticLighting() {
    return this.#realisticLighting
  }

  private get devicePixelRatio() {
    return Math.min(2.0, window.devicePixelRatio || 1.0)
  }

  start() {
    this.loadSettingsFromLocalStorage()
  }

  loadSettingsFromLocalStorage() {
    const persistedSettings = tryParseJson<GraphicSettings>(window.localStorage.getItem('graphicSettings'))

    if (persistedSettings) {
      this.setSettings(persistedSettings)
    } else {
      this.refresh()
    }
  }

  setSettings(settings: GraphicSettings) {
    this.#level = settings.level
    if (settings.realisticLighting !== undefined) this.#realisticLighting = settings.realisticLighting

    // Update custom settings if provided (only for Custom level)
    if (settings.level === GraphicLevels.Custom) {
      if (settings.customDrawDistance !== undefined) {
        this.#customDrawDistance = settings.customDrawDistance
      }
      if (settings.customWaterQuality !== undefined) {
        this.#customWaterQuality = settings.customWaterQuality
      }
      if (settings.customGlowEffects !== undefined) {
        this.#customGlowEffects = settings.customGlowEffects
      }
      if (settings.customAntiAliasing !== undefined) {
        this.#customAntiAliasing = settings.customAntiAliasing
      }
      if (settings.customSharpening !== undefined) {
        this.#customSharpening = settings.customSharpening
      }
      if (settings.customMaxActiveParcels !== undefined) {
        this.#customMaxActiveParcels = settings.customMaxActiveParcels
      }
      if (settings.customFog !== undefined) {
        this.#customFog = settings.customFog
      }
    }

    window.localStorage.setItem('graphicSettings', JSON.stringify(settings))
    this.refresh()

    const customSettings =
      settings.level === GraphicLevels.Custom
        ? {
            customDrawDistance: this.#customDrawDistance,
            customWaterQuality: this.#customWaterQuality,
            customGlowEffects: this.#customGlowEffects,
            customAntiAliasing: this.#customAntiAliasing,
            customSharpening: this.#customSharpening,
            customMaxActiveParcels: this.#customMaxActiveParcels,
            customFog: this.#customFog,
          }
        : undefined

    this.dispatchEvent(
      createEvent('settingsChanged', {
        level: this.#level,
        customSettings,
      }),
    )
  }

  getSettings(): GraphicSettings {
    return {
      level: this.#level,
      realisticLighting: this.#realisticLighting,
      customDrawDistance: this.#customDrawDistance,
      customWaterQuality: this.#customWaterQuality,
      customGlowEffects: this.#customGlowEffects,
      customAntiAliasing: this.#customAntiAliasing,
      customSharpening: this.#customSharpening,
      customMaxActiveParcels: this.#customMaxActiveParcels,
      customFog: this.#customFog,
    }
  }

  private refresh() {
    if (isBatterySaver()) {
      this.engine.setHardwareScalingLevel(1 / this.devicePixelRatio)
    } else if (this.#level === GraphicLevels.Low) {
      this.engine.setHardwareScalingLevel(1)
    } else {
      // Custom and all other levels use full resolution
      this.engine.setHardwareScalingLevel(1 / this.devicePixelRatio)
    }
  }
}

function tryParseJson<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch (ex) {
    return null
  }
}
