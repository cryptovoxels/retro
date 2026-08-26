import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import { ColorInput, toColor3 } from './color-utils'
import { stubMaterial } from '../utils/stub-mesh'
import { Color3, Material, SceneContext } from '@babylonjs/lite'

export interface GlassConfig {
  name?: string
  alpha?: number
  tint?: ColorInput
  roughness?: number
  indexOfRefraction?: number
}

export function createGlassMaterial(scene: SceneContext, config: GlassConfig = {}): Material {
  // Parse color if provided
  const parsedTint = config.tint ? toColor3(config.tint) : undefined

  const cacheKey = generateCacheKey('glass', {
    alpha: config.alpha,
    tint: parsedTint,
  })

  const cached = getCachedMaterial(cacheKey)
  if (cached) return cached

  const material = stubMaterial() as Material
  const baseColor = parsedTint || ([0.5, 0.55, 0.64] as Color3)
  ;(material as any).diffuseColor = baseColor
  ;(material as any).emissiveColor = baseColor
  material.alpha = config.alpha ?? 0.25
  ;(material as any).zOffset = 1
  ;(material as any).needDepthPrePass = false
  material.backFaceCulling = false

  if (scene.environmentTexture) {
    ;(material as any).reflectionTexture = scene.environmentTexture
    ;(material as any).reflectionTexture.coordinatesMode = 0
    ;(material as any).reflectionTexture.level = 0.3
  }

  ;(material as any).freeze = () => {}
  ;(material as any).blockDirtyMechanism = true
  ;(material as any).onDisposeObservable = { add: () => {} }
  ;(material as any).dispose = () => {}

  cacheMaterial(cacheKey, material)
  return material
}
