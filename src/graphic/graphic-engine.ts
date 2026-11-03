import { isBatterySaver } from '../../common/helpers/detector'
import { createEvent, TypedEventTarget } from '../utils/EventEmitter'
import type { PostProcesses } from './post-processes'

let opacitySorting = false
// Babylon 9.25 treats a null transparent comparator as the default sort.
const renderSorted = (BABYLON.RenderingGroup as any)._RenderSorted
;(BABYLON.RenderingGroup as any)._RenderSorted = function (submeshes: BABYLON.SmartArray<BABYLON.SubMesh>, compare: any, camera: BABYLON.Camera, transparent: boolean, disableDepthPrePass: boolean) {
  if (!transparent || opacitySorting) return renderSorted.call(this, submeshes, compare, camera, transparent, disableDepthPrePass)
  for (let i = 0; i < submeshes.length; i++) {
    const submesh = submeshes.data[i]
    const scene = submesh.getMesh().getScene()
    if ((scene as any)._activeMeshesFrozenButKeepClipping && !submesh.isInFrustum((scene as any)._frustumPlanes)) continue
    if (submesh.getMaterial()?.needDepthPrePass && !disableDepthPrePass) {
      const engine = scene.getEngine()
      engine.setColorWrite(false)
      engine.setAlphaMode(BABYLON.Engine.ALPHA_DISABLE)
      submesh.render(false)
      engine.setColorWrite(true)
    }
    submesh.render(true)
  }
}

export enum GraphicLevels {
  Low = 0,
  Medium = 1,
  High = 2,
  Ultra = 3,
}

export interface GraphicSettings {
  level: GraphicLevels
  reflections?: boolean
  opacitySorting?: boolean
}

export class GraphicEngine extends TypedEventTarget<{
  settingsChanged: { level: GraphicLevels }
}> {
  private readonly engine: BABYLON.Engine
  #level: GraphicLevels
  private reflections = false
  private opacitySorting = false
  public postProcesses?: PostProcesses

  constructor(engine: BABYLON.Engine) {
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
    this.reflections = settings.reflections === true
    this.opacitySorting = settings.opacitySorting === true

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
      reflections: this.reflections,
      opacitySorting: this.opacitySorting,
    }
  }

  private refresh() {
    BABYLON.MaterialFlags.ReflectionTextureEnabled = this.reflections
    opacitySorting = this.opacitySorting
    if (isBatterySaver()) {
      this.engine.setHardwareScalingLevel(1)
    } else if (this.#level === GraphicLevels.Low || this.#level === GraphicLevels.Medium) {
      this.engine.setHardwareScalingLevel(1)
    } else {
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
