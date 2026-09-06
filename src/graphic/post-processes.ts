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
  private coverEl: HTMLDivElement | null = null
  private revealing = false
  private coverObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null

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

  cover() {
    if (this.coverObs) {
      this.scene.onBeforeRenderObservable.remove(this.coverObs)
      this.coverObs = null
    }
    this.revealing = false

    const canvas = this.scene.getEngine().getRenderingCanvas()
    const parent = canvas?.parentElement
    if (!parent) return

    if (!this.coverEl) {
      const el = document.createElement('div')
      el.style.cssText = 'position:absolute;inset:0;background:#808080;pointer-events:none;z-index:1'
      if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
        parent.style.position = 'relative'
      }
      parent.appendChild(el)
      this.coverEl = el
    }
    this.coverEl.style.opacity = '1'
  }

  reveal() {
    if (!this.coverEl) {
      if (!isLoaded()) markLoaded()
      return
    }
    if (this.revealing) return
    this.revealing = true
    if (!isLoaded()) markLoaded()

    let elapsed = 0
    this.coverObs = this.scene.onBeforeRenderObservable.add(() => {
      elapsed += this.scene.getEngine().getDeltaTime()
      const t = 1 - Math.min(1, elapsed / 400)
      if (this.coverEl) this.coverEl.style.opacity = String(t)

      if (t <= 0) {
        if (this.coverObs) {
          this.scene.onBeforeRenderObservable.remove(this.coverObs)
          this.coverObs = null
        }
        this.coverEl?.remove()
        this.coverEl = null
        this.revealing = false
      }
    })
  }

  setBlur(on: boolean) {
    const camera = this.scene.activeCamera
    if (!camera) return

    if (on) {
      const t0 = performance.now()
      if (this.blurPP) return

      const pp = new BABYLON.BlurPostProcess('focusBlur', new BABYLON.Vector2(1, 0), 8, 1.0, camera)
      pp.onApply = () => {
        const t1 = performance.now()
        pp.kernel = Math.min(64, 8 + (t1 - t0) * 0.02)
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
