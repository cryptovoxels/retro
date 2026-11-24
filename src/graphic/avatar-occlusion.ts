import { effect, signal } from '@preact/signals'
import type Avatar from '../avatar'

const stored = (() => {
  try {
    return JSON.parse(localStorage.getItem('avatarShadow') || '{}')
  } catch {
    return {}
  }
})()
export const shadowEnabled = signal<boolean>(stored.enabled ?? true)
export const shadowIntensity = signal<number>(stored.intensity ?? 0.4)
export const shadowGamma = signal<number>(stored.gamma ?? 3.5)
export const shadowSize = signal<number>(stored.size ?? 0.45)
effect(() => {
  try {
    localStorage.setItem('avatarShadow', JSON.stringify({ enabled: shadowEnabled.value, intensity: shadowIntensity.value, gamma: shadowGamma.value, size: shadowSize.value }))
  } catch {}
})

// Heights and radii are in metres above the soles. No normals: graphic, not physical.
const shader = `
varying vUV: vec2<f32>;
var textureSampler: texture_2d<f32>;
var textureSamplerSampler: sampler;
var depthMap: texture_2d<f32>;
var depthMapSampler: sampler;
uniform inverseVP: mat4x4<f32>;
uniform soles: array<vec4<f32>, 4>;
uniform feet: array<vec4<f32>, 8>;
uniform count: i32;
uniform intensity: f32;
uniform gamma: f32;
uniform size: f32;
fn blob(p: vec3f, height: f32, radius: f32) -> f32 {
  let l = vec3f(0.0, height, 0.0) - p;
  let d2 = max(dot(l, l), 0.0001) / (uniforms.size * uniforms.size);
  return min(radius * radius / d2, 1.0) * (1.0 - smoothstep(0.36, 1.44, d2));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var color = textureSample(textureSampler, textureSamplerSampler, fragmentInputs.vUV);
  let depth = textureSample(depthMap, depthMapSampler, fragmentInputs.vUV).r;
  if (uniforms.count > 0 && depth > 0.0) {
    let h = uniforms.inverseVP * vec4f(fragmentInputs.vUV * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), depth, 1.0);
    let p = h.xyz / h.w;
    var light = 1.0;
    for (var i = 0; i < 4; i++) {
      if (i >= uniforms.count) { break; }
      let local = p - uniforms.soles[i].xyz;
      if (dot(local.xz, local.xz) > 1.44 * uniforms.size * uniforms.size) { continue; }
      light *= (1.0 - blob(p - uniforms.feet[i * 2].xyz, 0.0, 0.22)) * (1.0 - blob(p - uniforms.feet[i * 2 + 1].xyz, 0.0, 0.22)) *
               (1.0 - blob(local, 0.77, 0.28)) * (1.0 - blob(local, 1.22, 0.32));
    }
    color = vec4f(color.rgb * mix(1.0 - uniforms.intensity, 1.0, smoothstep(0.1, 0.9, pow(light, uniforms.gamma))), color.a);
  }
  fragmentOutputs.color = color;
}`

export function avatarOcclusion(scene: BABYLON.Scene) {
  const engine = scene.getEngine()
  const camera = scene.activeCamera
  if (!camera || !engine.getCaps().textureFloatRender) return null

  const depth = scene.enableDepthRenderer(camera, true, true, BABYLON.Texture.NEAREST_SAMPLINGMODE)
  depth.useOnlyInActiveCamera = true
  depth.enabled = false
  depth.clearColor.r = 0
  const map = depth.getDepthMap()
  // Half res: the shadow is a hard blob, nobody can tell, and it quarters the depth pass.
  const fit = () => map.resize({ width: engine.getRenderWidth() >> 1, height: engine.getRenderHeight() >> 1 })
  fit()
  const resize = engine.onResizeObservable.add(fit)
  scene.onDisposeObservable.add(() => engine.onResizeObservable.remove(resize))
  map.forceLayerMaskCheck = true
  const mask = new BABYLON.StandardMaterial('avatar depth mask', scene)
  mask.disableLighting = true
  mask.diffuseColor.set(0, 0, 0)
  mask.specularColor.set(0, 0, 0)
  mask.fogEnabled = false
  mask.freeze()

  const meshes: BABYLON.AbstractMesh[] = []
  map.getCustomRenderList = (_, active, length) => {
    meshes.length = 0
    for (let i = 0; active && i < length; i++) {
      const mesh = active[i]
      const bounds = mesh.getBoundingInfo().boundingSphere
      if (BABYLON.Vector3.DistanceSquared(camera.globalPosition, bounds.centerWorld) > (8 + bounds.radiusWorld) ** 2) continue
      // Black marks avatar pixels, including skinned meshes and wearables.
      if (mesh.metadata?.isAvatarPart && !mesh.getMaterialForRenderPass(map.renderPassId)) depth.setMaterialForRendering(mesh, mask)
      meshes.push(mesh)
    }
    return meshes
  }

  const soles = new Array<number>(16).fill(0)
  const feet = new Array<number>(32).fill(0)
  const foot = new BABYLON.Vector3()
  const nearest: Avatar[] = []
  const eye = camera.globalPosition
  const distance = (avatar: Avatar) => BABYLON.Vector3.DistanceSquared(eye, avatar.absolutePosition)
  const closest = (a: Avatar, b: Avatar) => distance(a) - distance(b)
  function collect(avatar?: Avatar | null) {
    if (avatar && distance(avatar) <= 25) nearest.push(avatar)
  }
  scene.onBeforeRenderObservable.add(() => {
    nearest.length = 0
    const connector = window.connector
    if (shadowEnabled.value && scene.activeCamera === camera && connector) {
      collect(connector.persona.avatar)
      for (const avatar of connector.avatarsByUuid.values()) collect(avatar)
    }
    if (nearest.length > 4) {
      nearest.sort(closest)
      nearest.length = 4
    }
    for (let i = 0; i < nearest.length; i++) {
      nearest[i].absolutePosition.toArray(soles, i * 4)
      soles[i * 4 + 1] -= nearest[i].height
      for (let f = 0; f < 2; f++) {
        nearest[i].footPosition(f, foot)
        foot.toArray(feet, (i * 2 + f) * 4)
      }
    }
    depth.enabled = nearest.length > 0
  })

  BABYLON.ShaderStore.ShadersStoreWGSL.avatarOcclusionFragmentShader = shader
  const pass = new BABYLON.PostProcess('avatar occlusion', 'avatarOcclusion', {
    uniforms: ['inverseVP', 'soles', 'feet', 'count', 'intensity', 'gamma', 'size'],
    samplers: ['depthMap'],
    size: 1,
    engine,
    samplingMode: BABYLON.Texture.NEAREST_SAMPLINGMODE,
    shaderLanguage: BABYLON.ShaderLanguage.WGSL,
  })
  const inverse = BABYLON.Matrix.Identity()
  pass.onApply = (fx) => {
    fx.setInt('count', nearest.length)
    fx.setTexture('depthMap', map)
    if (!nearest.length) return
    camera.getTransformationMatrix().invertToRef(inverse)
    fx.setMatrix('inverseVP', inverse)
    fx.setArray4('soles', soles)
    fx.setArray4('feet', feet)
    fx.setFloat('intensity', shadowIntensity.value)
    fx.setFloat('gamma', shadowGamma.value)
    fx.setFloat('size', shadowSize.value)
  }
  return pass
}
