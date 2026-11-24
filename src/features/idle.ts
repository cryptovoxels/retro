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
  getUniforms() {
    return {
      ubo: ['windClock', 'windBox'].map((name) => ({ name, size: 4, type: 'vec4' })),
      vertex: 'uniform windClock: vec4f;\nuniform windBox: vec4f;',
    }
  }
  hardBindForSubMesh(buffer: BABYLON.UniformBuffer) {
    buffer.updateFloat4('windClock', this.clock.phase, this.speed, this.amount, Number(this.flag))
    buffer.updateFloat4('windBox', ...this.box)
  }
  getCustomCode(stage: string) {
    if (stage !== 'vertex') return null
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
      let phase = uniforms.windClock.x * uniforms.windClock.y + dot(finalWorld[3].xz, vec2f(.59,.31));
      if (uniforms.windClock.w > .5) {
        let reach = clamp((positionUpdated.x-uniforms.windBox.x)/uniforms.windBox.z-.08,0.,1.);
        worldPos += vec4f(finalWorld[2].xyz * (uniforms.windBox.z*uniforms.windClock.z*reach*
          (sin(phase-5.*reach)+.22*sin(2.*phase-8.*reach))),0.);
      } else {
        let tip = clamp((positionUpdated.y-uniforms.windBox.y)/uniforms.windBox.w,0.,1.);
        let bend = tip*tip * uniforms.windBox.w*length(finalWorld[1].xyz)*uniforms.windClock.z;
        worldPos += vec4f(.89,0.,.46,0.)*bend*(sin(phase)+.24*sin(2.*phase+dot(worldPos.xz,vec2f(.7,-.4))));
      }`,
    }
  }
}
