import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import type { ColorInput } from './color-utils'
import { toColor3 } from './color-utils'
import { Material, SceneContext, createStandardMaterial } from '@babylonjs/lite'

export interface LanternMaterialConfig {
  color: ColorInput
  strength?: number
}

export function createLanternMaterial(_scene: SceneContext, config: LanternMaterialConfig): Material {
  const lanternColor = toColor3(config.color)
  const strength = (config.strength ?? 50) / 50

  const cacheKey = generateCacheKey('lantern', {
    color: lanternColor,
    strength,
  })

  const cached = getCachedMaterial(cacheKey)
  if (cached) return cached

  const material = createStandardMaterial()
  material.disableLighting = true
  material.diffuseColor = [0, 0, 0]
  material.specularColor = [0, 0, 0]
  material.emissiveColor = [lanternColor[0] * strength, lanternColor[1] * strength, lanternColor[2] * strength]

  cacheMaterial(cacheKey, material)
  return material
}
