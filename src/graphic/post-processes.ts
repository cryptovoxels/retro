import { type GraphicEngine } from './graphic-engine'
import { isLoaded, markLoaded } from '../utils/loading-done'

export class PostProcesses {
  private readonly scene: BABYLON.Scene
  private blurPP: BABYLON.Nullable<BABYLON.PostProcess> = null
  private underwaterPP: BABYLON.Nullable<BABYLON.PostProcess> = null
  private coverPP: BABYLON.Nullable<BABYLON.PostProcess> = null
  private coverAmount = 1
  private revealing = false
  private coverObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null

  constructor(scene: BABYLON.Scene, graphics: GraphicEngine) {
    this.scene = scene
  }

  cover() {
    const camera = this.scene.activeCamera
    if (!camera) return

    if (this.coverObs) {
      this.scene.onBeforeRenderObservable.remove(this.coverObs)
      this.coverObs = null
    }
    this.revealing = false
    this.coverAmount = 1

    if (this.coverPP) return

    if (!BABYLON.Effect.ShadersStore['worldCoverPixelShader']) {
      BABYLON.Effect.ShadersStore['worldCoverPixelShader'] = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;

void main(void) {
  gl_FragColor = mix(texture2D(textureSampler, vUV), vec4(0.5, 0.5, 0.5, 1.0), amount);
}
`
    }

    const pp = new BABYLON.PostProcess('worldCover', 'worldCover', ['amount'], null, 1.0, camera, BABYLON.Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false)
    pp.onApply = (effect) => {
      effect.setFloat('amount', this.coverAmount)
    }
    this.coverPP = pp
  }

  reveal() {
    if (!this.coverPP) {
      if (!isLoaded()) markLoaded()
      return
    }
    if (this.revealing) return
    this.revealing = true
    if (!isLoaded()) markLoaded()

    let elapsed = 0
    this.coverObs = this.scene.onBeforeRenderObservable.add(() => {
      elapsed += this.scene.getEngine().getDeltaTime()
      this.coverAmount = 1 - Math.min(1, elapsed / 400)

      if (this.coverAmount <= 0) {
        this.coverAmount = 0
        if (this.coverObs) {
          this.scene.onBeforeRenderObservable.remove(this.coverObs)
          this.coverObs = null
        }
        const camera = this.scene.activeCamera
        if (this.coverPP) {
          try {
            camera?.detachPostProcess(this.coverPP)
          } catch {}
          this.coverPP.dispose()
          this.coverPP = null
        }
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
}
