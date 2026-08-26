// ABOUTME: Dedicated material for lantern features
// ABOUTME: Creates self-lit glowing appearance using emissive color

import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import type { ColorInput } from './color-utils'
import { toColor3 } from './color-utils'
import { Color3, Material, SceneContext } from '@babylonjs/lite'

export interface LanternMaterialConfig {
  color: ColorInput // Lantern color (hex string or Color3)
  strength?: number // Light strength 1-100, affects emissive intensity
}

/**
 * Create a lantern material that looks like a glowing light source
 */
export function createLanternMaterial(scene: SceneContext, config: LanternMaterialConfig): Material {
  const lanternColor = toColor3(config.color)
  const strength = config.strength ?? 50

  const cacheKey = generateCacheKey('lantern', {
    color: lanternColor,
    strength,
  })

  const cached = getCachedMaterial(cacheKey)
  if (cached) return cached

  const texture = (undefined as any /* todo(lite): new BABYLON.Texture('/textures/00-grid.png', scene) */)

  const material = (undefined as any /* todo(lite): new BABYLON.StandardMaterial(`lantern/${Date.now()}`, scene) */)

  material.ambientTexture = texture
  material.emissiveColor = lanternColor

  // Zero out all other color channels to prevent mixing with other lights
  material.diffuseColor = ([0, 0, 0] as Color3)
  // material.specularColor = new BABYLON.Color3(0, 0, 0)
  // material.ambientColor = new BABYLON.Color3(0, 0, 0)

  material.freeze()
  material.blockDirtyMechanism = true

  cacheMaterial(cacheKey, material)
  return material
}
