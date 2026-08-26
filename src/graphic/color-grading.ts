import { SceneContext } from '@babylonjs/lite'
export class ColorGrader {
  disposed = false
  private readonly _postProcess: any
  private sandboxOn = false
  private sandboxPP: (any | null) = null

  constructor(private scene: SceneContext) {
    // warning setting reusable to true causes youtube and twitch videos to wobble... not sure why
    this._postProcess = (undefined as any /* todo(lite): new BABYLON.ImageProcessingPostProcess('luts', 1.0, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT) */)
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
    const camera = this.scene.activeCamera
    if (!camera) return

    if (!(undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['sandboxBorderPixelShader'] */)) {
      (undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['sandboxBorderPixelShader'] = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 screenSize;
uniform float borderWidth;

void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  vec2 px = vUV * screenSize;
  float d = min(min(px.x, screenSize.x - px.x), min(px.y, screenSize.y - px.y));
  float t = 1.0 - clamp(d / borderWidth, 0.0, 1.0);
  // #FF00AA - solid at the rim, fades out toward the middle
  vec3 pink = vec3(1.0, 0.0, 0.6666667);
  color.rgb = mix(color.rgb, pink, t);
  gl_FragColor = color;
}
` */)
    }

    if (this.sandboxPP) {
      try {
        camera.attachPostProcess(this.sandboxPP)
      } catch {}
      return
    }

    const engine = this.scene.getEngine()
    const pp = (undefined as any /* todo(lite): new BABYLON.PostProcess('sandboxBorder', 'sandboxBorder', ['screenSize', 'borderWidth'], null, 1.0, camera, BABYLON.Texture.BILINEAR_SAMPLINGMODE, engine, false) */)
    pp.onApply = (effect) => {
      effect.setFloat2('screenSize', engine.getRenderWidth(), engine.getRenderHeight())
      effect.setFloat('borderWidth', 30.0)
    }
    this.sandboxPP = pp
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
    // Ensure applyByPostProcess stays true so materials don't do their own processing
    this._postProcess.imageProcessingConfiguration.applyByPostProcess = true
    if (this.sandboxOn) {
      this.detachSandboxBorder()
      this.sandboxOn = false
      this.setSandboxLook(true)
    }
  }

  dispose() {
    this.detachSandboxBorder()
    this._postProcess.dispose()
    this.disposed = true
  }
}
