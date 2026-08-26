import { isBatterySaver } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import type { PostProcesses } from './post-processes'
import { EngineContext, resizeEngine } from '@babylonjs/lite'

export enum GraphicLevels {
  Low = 0,
  Medium = 1,
  High = 2,
  Ultra = 3,
}

export interface GraphicSettings {
  level: GraphicLevels
}

export class GraphicEngine extends TypedEventTarget<{
  settingsChanged: { level: GraphicLevels }
}> {
  private readonly engine: EngineContext
  #level: GraphicLevels
  public postProcesses?: PostProcesses

  constructor(engine: EngineContext) {
    super()
    this.engine = engine

    // Default to ultra low graphics level until we're confident we can increase the quality
    this.#level = GraphicLevels.Medium
  }

  get level() {
    return this.#level
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
    // old Custom (= 4) -> Medium
    let level = settings.level
    if ((level as number) === 4 || level === undefined || level === null) {
      level = GraphicLevels.Medium
    }

    this.#level = level

    window.localStorage.setItem('graphicSettings', JSON.stringify(this.getSettings()))
    this.refresh()

    this.dispatchEvent(
      createEvent('settingsChanged', {
        level: this.#level,
      }),
    )
  }

  getSettings(): GraphicSettings {
    return {
      level: this.#level,
    }
  }

  private refresh() {
    const surface = this.engine.surfaces[0]
    const useFullDpr =
      !isBatterySaver() && (this.#level === GraphicLevels.Low || this.#level === GraphicLevels.Medium)
    surface.maxDevicePixelRatio = useFullDpr ? this.devicePixelRatio : 1
    resizeEngine(this.engine)
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
