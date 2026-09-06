export class ColorGrader {
  disposed = false
  private readonly _postProcess: BABYLON.ImageProcessingPostProcess

  constructor(private scene: BABYLON.Scene) {
    // warning setting reusable to true causes youtube and twitch videos to wobble... not sure why
    this._postProcess = new BABYLON.ImageProcessingPostProcess('luts', 1.0, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT)
    this._postProcess.colorGradingEnabled = false
    this._postProcess.colorCurvesEnabled = false
    this._postProcess.toneMappingEnabled = false
    this._postProcess.vignetteEnabled = false
    this._postProcess.samples = 1
  }

  public get postProcess(): BABYLON.ImageProcessingPostProcess {
    return this._postProcess
  }

  setSandboxLook(_on: boolean) {}

  reload() {
    this._postProcess.imageProcessingConfiguration.applyByPostProcess = true
  }

  dispose() {
    this._postProcess.dispose()
    this.disposed = true
  }
}
