import { GraphicLevels, type GraphicEngine } from './graphic-engine'
import type { ColorGrader } from './color-grading'
import { isLoaded, markLoaded } from '../utils/loading-done'
import { wantsGateway } from '../../common/helpers/detector'

export class PostProcesses {
  private readonly scene: BABYLON.Scene
  private readonly colorGrader: ColorGrader
  private readonly pipelines: Record<GraphicLevels, BABYLON.PostProcessRenderPipeline>
  private glowLayer: BABYLON.Nullable<BABYLON.GlowLayer> = null
  private blurPP: BABYLON.Nullable<BABYLON.BlurPostProcess> = null
  private blurCamera: BABYLON.Nullable<BABYLON.Camera> = null

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

  // Fixed kernel, built once, attached/detached per dialog. Changing `kernel` at runtime swaps in an
  // uncompiled effect mid-apply and the resulting throw kills the render loop (world freeze).
  setBlur(on: boolean) {
    if (on) {
      const camera = this.scene.activeCamera
      if (!camera || this.blurCamera) return
      if (!this.blurPP) {
        this.blurPP = new BABYLON.BlurPostProcess('focusBlur', new BABYLON.Vector2(1, 0), 24, 1.0, null, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine())
      }
      camera.attachPostProcess(this.blurPP)
      this.blurCamera = camera
    } else if (this.blurPP && this.blurCamera) {
      try {
        this.blurCamera.detachPostProcess(this.blurPP)
      } catch {}
      this.blurCamera = null
    }
  }

  setUnderwater(_on: boolean) {}

  changeEffects(level: GraphicLevels) {
    if (wantsGateway()) return
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
      const cam = this.scene.activeCamera
      if (!cam) return
      this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(p.name, cam)
    })

    const cam = this.scene.activeCamera
    if (cam) {
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(this.pipelines[level].name, cam)
    }
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
