import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import { ColorInput, toColor3 } from './color-utils'
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

  const material = (undefined as any /* todo(lite): new BABYLON.StandardMaterial(`glass/${config.name || 'default'}/${Date.now()}`, scene) */)

  const baseColor = parsedTint || ([0.5, 0.55, 0.64] as Color3)
  material.diffuseColor = baseColor
  material.emissiveColor = baseColor
  material.alpha = config.alpha ?? 0.25
  material.zOffset = 1
  material.needDepthPrePass = false
  material.backFaceCulling = false

  // Add environment texture reflections for glass if available
  if (scene.environmentTexture) {
    material.reflectionTexture = scene.environmentTexture
    material.reflectionTexture.coordinatesMode = (undefined as any /* todo(lite): BABYLON.Texture.CUBIC_MODE */)
    material.reflectionTexture.level = 0.3 // Subtle reflections for glass
  }

  material.freeze()
  material.blockDirtyMechanism = true

  cacheMaterial(cacheKey, material)
  return material
}
