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
    // Enable dithering to break up gradient banding (same as skybox material)
    // Adds subtle noise to overcome precision issues in shader pipeline
    this._postProcess.imageProcessingConfiguration.ditheringEnabled = true
    this._postProcess.imageProcessingConfiguration.ditheringIntensity = 1.0 / 255.0
    // Explicitly set applyByPostProcess to ensure materials skip their own image processing
    this._postProcess.imageProcessingConfiguration.applyByPostProcess = true
    this._postProcess.samples = 1
  }

  public get postProcess(): BABYLON.ImageProcessingPostProcess {
    return this._postProcess
  }

  // if post-processing pipeline changes we need to re-apply settings
  reload() {
    // Ensure applyByPostProcess stays true so materials don't do their own processing
    this._postProcess.imageProcessingConfiguration.applyByPostProcess = true
  }

  dispose() {
    this._postProcess.dispose()
    this.disposed = true
  }
}
