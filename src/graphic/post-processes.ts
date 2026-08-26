import { GraphicLevels, type GraphicEngine } from './graphic-engine'
import type { ColorGrader } from './color-grading'
import { isLoaded, markLoaded } from '../utils/loading-done'
import { SceneContext } from '@babylonjs/lite'

export class PostProcesses {
  private readonly scene: SceneContext
  private readonly colorGrader: ColorGrader
  private readonly pipelines: Record<GraphicLevels, any>

  constructor(scene: SceneContext, color: ColorGrader, graphics: GraphicEngine) {
    this.scene = scene
    this.colorGrader = color
    // todo(lite): BJS post-process render pipelines
    this.pipelines = {} as Record<GraphicLevels, any>
    graphics.addEventListener('settingsChanged', () => {})
  }

  cover() {}

  reveal() {
    if (!isLoaded()) markLoaded()
  }

  setBlur(_on: boolean) {}

  setUnderwater(_on: boolean) {}

  changeEffects(_level: GraphicLevels) {}
}
