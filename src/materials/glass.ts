import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import { ColorInput, toColor3 } from './color-utils'

export interface GlassConfig {
  name?: string
  alpha?: number
  tint?: ColorInput
  roughness?: number
  indexOfRefraction?: number
}

export function createGlassMaterial(scene: BABYLON.Scene, config: GlassConfig = {}): BABYLON.Material {
  // Parse color if provided
  const parsedTint = config.tint ? toColor3(config.tint) : undefined

  const cacheKey = generateCacheKey('glass', {
    alpha: config.alpha,
    tint: parsedTint,
  })

  const cached = getCachedMaterial(cacheKey)
  if (cached) return cached

  const material = new BABYLON.StandardMaterial(`glass/${config.name || 'default'}/${Date.now()}`, scene)

  const baseColor = new BABYLON.Color3(0.3, 0.4, 0.6)
  material.diffuseColor = baseColor
  material.specularColor = new BABYLON.Color3(1, 1, 1)
  material.emissiveColor = baseColor
  material.backFaceCulling = false
  material.alpha = 0.5
  material.zOffset = -1
  // material.needDepthPrePass = true

  // Add environment texture reflections for glass if available
  if (scene.environmentTexture) {
    material.reflectionTexture = scene.environmentTexture
    material.reflectionTexture.coordinatesMode = BABYLON.Texture.CUBIC_MODE
    material.reflectionTexture.level = 0.3 // Subtle reflections for glass
  }

  material.freeze()
  material.blockDirtyMechanism = true

  cacheMaterial(cacheKey, material)
  return material
}
