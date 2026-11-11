import type { Idling } from '../../common/messages/feature'

// One wind clock per scene. Integer cycles keep the minute-long loop seamless.
const clocks = new WeakMap<BABYLON.Scene, { phase: number }>()
const winds: Record<Idling, [number, number]> = { grass: [19, 0.13], bush: [11, 0.065], tree: [7, 0.038], flag: [13, 0.12] }

export function idleWind(mesh: BABYLON.Mesh, idle: Idling) {
  const mat = mesh.material as BABYLON.StandardMaterial
  if (!mat || !winds[idle]) return
  const scene = mesh.getScene()
  let clock = clocks.get(scene)
  if (!clock) {
    const shared = { phase: 0 }
    scene.onBeforeRenderObservable.add(() => {
      shared.phase = ((Date.now() % 64000) * Math.PI) / 32000
    })
    clocks.set(scene, shared)
    clock = shared
  }
  const { minimum: min, maximum: max } = mesh.getBoundingInfo().boundingBox
  const [speed, amount] = winds[idle]
  const flag = idle === 'flag'
  new WindMaterial(mat, clock, speed, amount, flag, [min.x, min.y, Math.max(1, max.x - min.x), Math.max(1, max.y - min.y)])
}

class WindMaterial extends BABYLON.MaterialPluginBase {
  constructor(
    mat: BABYLON.Material,
    private clock: { phase: number },
    private speed: number,
    private amount: number,
    private flag: boolean,
    private box: [number, number, number, number],
  ) {
    super(mat, 'voxWind', 200, {}, true, false)
    this.registerForExtraEvents = true
    this._enable(true)
  }
  getClassName() {
    return 'VoxWind'
  }
  isCompatible() {
    return true
  }
  getUniforms(lang: BABYLON.ShaderLanguage) {
    return {
      ubo: ['windClock', 'windBox'].map((name) => ({ name, size: 4, type: 'vec4' })),
      vertex: lang === BABYLON.ShaderLanguage.WGSL ? 'uniform windClock: vec4f;\nuniform windBox: vec4f;' : 'uniform vec4 windClock;\nuniform vec4 windBox;',
    }
  }
  hardBindForSubMesh(buffer: BABYLON.UniformBuffer) {
    buffer.updateFloat4('windClock', this.clock.phase, this.speed, this.amount, Number(this.flag))
    buffer.updateFloat4('windBox', ...this.box)
  }
  getCustomCode(stage: string, lang: BABYLON.ShaderLanguage) {
    if (stage !== 'vertex') return null
    const code = `
      float phase = windClock.x * windClock.y + dot(finalWorld[3].xz, vec2(.59,.31));
      if (windClock.w > .5) {
        float reach = clamp((positionUpdated.x-windBox.x)/windBox.z-.08,0.,1.);
        worldPos += vec4(finalWorld[2].xyz * (windBox.z*windClock.z*reach*
          (sin(phase-5.*reach)+.22*sin(2.*phase-8.*reach))),0.);
      } else {
        float tip = clamp((positionUpdated.y-windBox.y)/windBox.w,0.,1.);
        float bend = tip*tip * windBox.w*length(finalWorld[1].xyz)*windClock.z;
        worldPos += vec4(.89,0.,.46,0.)*bend*(sin(phase)+.24*sin(2.*phase+dot(worldPos.xz,vec2(.7,-.4))));
      }`
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS:
        lang === BABYLON.ShaderLanguage.WGSL
          ? code
              .replace(/float /g, 'let ')
              .replace(/vec([24])\(/g, 'vec$1f(')
              .replace(/wind(Clock|Box)/g, 'uniforms.wind$1')
          : code,
    }
  }
}
