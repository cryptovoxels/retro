import { GraphicLevels, type GraphicEngine } from './graphic-engine'
import type { ColorGrader } from './color-grading'

export class PostProcesses {
  private readonly scene: BABYLON.Scene
  private readonly colorGrader: ColorGrader
  private readonly pipelines: Record<GraphicLevels, BABYLON.PostProcessRenderPipeline>
  private glowLayer: BABYLON.Nullable<BABYLON.GlowLayer> = null
  private blurPP: BABYLON.Nullable<BABYLON.PostProcess> = null
  private underwaterPP: BABYLON.Nullable<BABYLON.PostProcess> = null

  constructor(scene: BABYLON.Scene, color: ColorGrader, graphics: GraphicEngine) {
    this.scene = scene
    this.colorGrader = color

    const sharpen = new BABYLON.SharpenPostProcess('sharpen', 1.0, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false, BABYLON.Constants.TEXTURETYPE_UNSIGNED_INT)
    sharpen.edgeAmount = 0.1

    this.pipelines = {
      [GraphicLevels.Low]: this.createPipeline(GraphicLevels.Low, [this.colorGrader.postProcess]),
      [GraphicLevels.Medium]: this.createPipeline(GraphicLevels.Medium, [this.colorGrader.postProcess]),
      [GraphicLevels.High]: this.createPipeline(GraphicLevels.High, [this.colorGrader.postProcess, sharpen]),
      [GraphicLevels.Ultra]: this.createPipeline(GraphicLevels.Ultra, [this.colorGrader.postProcess, sharpen]),
    }

    // Initialize with current graphics level
    this.changeEffects(graphics.level)

    // Listen to graphics changes
    graphics.addEventListener('settingsChanged', (event) => {
      this.changeEffects(event.detail.level)
    })
  }

  setBlur(on: boolean) {
    const camera = this.scene.activeCamera
    if (!camera) return

    if (on) {
      const t0 = performance.now()

      if (this.blurPP) return
      if (!BABYLON.Effect.ShadersStore['focusBlurPixelShader']) {
        BABYLON.Effect.ShadersStore['focusBlurPixelShader'] = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float time;
uniform float amount;

void main(void) {
  float w = sin(time * 2.2 + vUV.y * 12.0) * amount * 0.004;
  float w2 = cos(time * 1.7 + vUV.x * 10.0) * amount * 0.003;
  vec2 uv = vUV + vec2(w, w2);
  float r = texture2D(textureSampler, uv + vec2(amount * 0.006, 0.0)).r;
  float g = texture2D(textureSampler, uv).g;
  float b = texture2D(textureSampler, uv - vec2(amount * 0.006, 0.0)).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
`
      }
      const pp = new BABYLON.PostProcess('focusBlur', 'focusBlur', ['time', 'amount'], null, 1.0, camera, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false)

      pp.onApply = (effect) => {
        const t1 = performance.now()
        effect.setFloat('time', t1 * 0.001)

        const amount = Math.min(12.0, (t1 - t0) * 0.004)
        effect.setFloat('amount', amount)
      }
      this.blurPP = pp
    } else if (this.blurPP) {
      try {
        camera.detachPostProcess(this.blurPP)
      } catch {}
      this.blurPP.dispose()
      this.blurPP = null
    }
  }

  setUnderwater(on: boolean) {
    const camera = this.scene.activeCamera
    if (!camera) return

    if (on) {
      if (this.underwaterPP) return
      if (!BABYLON.Effect.ShadersStore['underwaterPixelShader']) {
        BABYLON.Effect.ShadersStore['underwaterPixelShader'] = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float time;

void main(void) {
  float w = sin(time * 2.2 + vUV.y * 12.0) * 0.04;
  float w2 = cos(time * 1.7 + vUV.x * 10.0) * 0.03;
  vec2 uv = vUV + vec2(w, w2);
  vec3 c = texture2D(textureSampler, uv).xyz;
  float r = (c.x + c.y + c.z) / 3.0;
  gl_FragColor = vec4(0, r * 0.5, r, 1.0);
}
`
      }
      const pp = new BABYLON.PostProcess('underwater', 'underwater', ['time'], null, 1.0, camera, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false)
      pp.onApply = (effect) => {
        effect.setFloat('time', performance.now() * 0.001)
      }
      this.underwaterPP = pp
    } else if (this.underwaterPP) {
      try {
        camera.detachPostProcess(this.underwaterPP)
      } catch {}
      this.underwaterPP.dispose()
      this.underwaterPP = null
    }
  }

  changeEffects(level: GraphicLevels) {
    this.colorGrader.reload()
    if (this.glowLayer) {
      this.glowLayer.dispose()
      this.glowLayer = null
    }

    switch (level) {
      case GraphicLevels.Low:
        this.colorGrader.postProcess.samples = 1
        break
      case GraphicLevels.Medium:
        this.colorGrader.postProcess.samples = 1
        break
      case GraphicLevels.High:
        this.colorGrader.postProcess.samples = 2
        this.glowLayer = glow(this.scene, 48, 2, 0.1)
        break
      case GraphicLevels.Ultra:
        this.colorGrader.postProcess.samples = 8
        this.glowLayer = glow(this.scene, 48, 2, 0.1)
        break
      default:
        this.colorGrader.postProcess.samples = 0
        level = GraphicLevels.Low
    }

    Object.values(this.pipelines).forEach((p) => {
      this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(p.name, this.scene.activeCamera)
    })

    this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(this.pipelines[level].name, this.scene.activeCamera)
  }

  private createPipeline(level: GraphicLevels, processes: BABYLON.PostProcess[]) {
    const pipeline = new BABYLON.PostProcessRenderPipeline(this.scene.getEngine(), `pipeline_${GraphicLevels[level]}`)
    pipeline.addEffect(new BABYLON.PostProcessRenderEffect(this.scene.getEngine(), `effect_${GraphicLevels[level]}`, () => processes))
    this.scene.postProcessRenderPipelineManager.addPipeline(pipeline)
    return pipeline
  }
}

function glow(scene: BABYLON.Scene, blur: number, intensity: number, glowAlpha: number) {
  const glowLayer = new BABYLON.GlowLayer('glow_layer', scene, {})
  glowLayer.blurKernelSize = blur
  glowLayer.intensity = intensity

  // this custom colour selector allows us to only glow selected meshes
  glowLayer.customEmissiveColorSelector = function (mesh, subMesh, material, result) {
    if (BABYLON.Tags.MatchesQuery(mesh, 'glow')) {
      const color = (material as BABYLON.StandardMaterial).emissiveColor
      if (color instanceof BABYLON.Color4) {
        return result.set(color.r, color.r, color.b, color.a)
      }
      if (color instanceof BABYLON.Color3) {
        return result.set(color.r, color.r, color.b, glowAlpha)
      }
    } else {
      result.set(0, 0, 0, 0)
    }
  }
  return glowLayer
}
