import { SceneContext } from '@babylonjs/lite'

function stubPostProcess() {
  return {
    colorGradingEnabled: false,
    colorCurvesEnabled: false,
    toneMappingEnabled: false,
    vignetteEnabled: false,
    imageProcessingConfiguration: {
      ditheringEnabled: true,
      ditheringIntensity: 1 / 255,
      applyByPostProcess: true,
    },
    samples: 1,
    dispose: () => {},
  }
}

export class ColorGrader {
  disposed = false
  private readonly _postProcess: ReturnType<typeof stubPostProcess>
  private sandboxOn = false
  private sandboxPP: (any | null) = null

  constructor(private scene: SceneContext) {
    // todo(lite): ImageProcessingPostProcess
    this._postProcess = stubPostProcess()
  }

  public get postProcess(): any {
    return this._postProcess
  }

  /** Pink #FF00AA fade on the outer 30px of the canvas while on a sandbox. */
  setSandboxLook(on: boolean) {
    if (on) {
      if (this.sandboxOn && this.sandboxPP) return
      this.sandboxOn = true
      this.attachSandboxBorder()
      return
    }
    if (!this.sandboxOn) return
    this.sandboxOn = false
    this.detachSandboxBorder()
  }

  private attachSandboxBorder() {
    // todo(lite): sandbox border post process
  }

  private detachSandboxBorder() {
    const camera = this.scene.activeCamera
    if (this.sandboxPP && camera) {
      try {
        camera.detachPostProcess(this.sandboxPP)
      } catch {}
    }
    this.sandboxPP?.dispose()
    this.sandboxPP = null
  }

  // if post-processing pipeline changes we need to re-apply settings
  reload() {
    this._postProcess.imageProcessingConfiguration.applyByPostProcess = true
  }

  dispose() {
    this.detachSandboxBorder()
    this._postProcess.dispose()
    this.disposed = true
  }
}
