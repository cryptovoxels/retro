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
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthMap;
uniform mat4 inverseVP;
uniform vec3 soles[4];
uniform vec3 feet[8];
uniform int count;
uniform float clipMin;
uniform float intensity;
uniform float gamma;
uniform float size;

float blob(vec3 p, float height, float radius) {
  vec3 l = vec3(0.0, height, 0.0) - p;
  float d2 = max(dot(l, l), 0.0001) / (size * size);
  return min(radius * radius / d2, 1.0) * (1.0 - smoothstep(0.36, 1.44, d2));
}

void main() {
  vec4 color = texture2D(textureSampler, vUV);
  float depth = count > 0 ? texture2D(depthMap, vUV).r : 0.0;
  if (depth > 0.0) {
    vec4 h = inverseVP * vec4(vUV * 2.0 - 1.0, mix(clipMin, 1.0, depth), 1.0);
    vec3 p = h.xyz / h.w;
    float light = 1.0;
    for (int i = 0; i < 4; i++) {
      if (i >= count) break;
      vec3 local = p - soles[i];
      if (dot(local.xz, local.xz) > 1.44 * size * size) continue;
      light *= (1.0 - blob(p - feet[i * 2], 0.0, 0.22)) * (1.0 - blob(p - feet[i * 2 + 1], 0.0, 0.22)) *
               (1.0 - blob(local, 0.77, 0.28)) * (1.0 - blob(local, 1.22, 0.32));
    }
    // Two tone: ink or paper, thin band between.
    color.rgb *= mix(1.0 - intensity, 1.0, smoothstep(0.1, 0.9, pow(light, gamma)));
  }
  gl_FragColor = color;
}`

export function avatarOcclusion(scene: BABYLON.Scene) {
  const engine = scene.getEngine()
  const camera = scene.activeCamera
  if (!camera || !engine.getCaps().textureFloatRender || (!engine.isWebGPU && engine.version < 2)) return null

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

  const soles = new Array<number>(12).fill(0)
  const feet = new Array<number>(24).fill(0)
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
      nearest[i].absolutePosition.toArray(soles, i * 3)
      soles[i * 3 + 1] -= nearest[i].height
      for (let f = 0; f < 2; f++) {
        nearest[i].footPosition(f, foot)
        foot.toArray(feet, (i * 2 + f) * 3)
      }
    }
    depth.enabled = nearest.length > 0
  })

  BABYLON.Effect.ShadersStore.avatarOcclusionFragmentShader = shader
  const pass = new BABYLON.PostProcess('avatar occlusion', 'avatarOcclusion', ['inverseVP', 'soles', 'feet', 'count', 'clipMin', 'intensity', 'gamma', 'size'], ['depthMap'], 1, null, BABYLON.Texture.NEAREST_SAMPLINGMODE, engine)
  const inverse = BABYLON.Matrix.Identity()
  pass.onApply = (fx) => {
    fx.setInt('count', nearest.length)
    fx.setTexture('depthMap', map)
    if (!nearest.length) return
    camera.getTransformationMatrix().invertToRef(inverse)
    fx.setMatrix('inverseVP', inverse)
    fx.setArray3('soles', soles)
    fx.setArray3('feet', feet)
    fx.setFloat('clipMin', engine.isNDCHalfZRange ? 0 : -1)
    fx.setFloat('intensity', shadowIntensity.value)
    fx.setFloat('gamma', shadowGamma.value)
    fx.setFloat('size', shadowSize.value)
  }
  return pass
}
