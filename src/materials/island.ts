import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'

export interface IslandMaterialConfig {
  name: string
  texture: BABYLON.Texture
}

export function createIslandMaterial(scene: BABYLON.Scene, config: IslandMaterialConfig): BABYLON.Material {
  const cacheKey = generateCacheKey('island', { name: config.name })

  const cached = getCachedMaterial(cacheKey)
  if (cached) return cached

  const material = new BABYLON.StandardMaterial(`island/${config.name}`, scene)

  // Standard material colors
  // material.emissiveColor.set(0.7, 0.7, 0.7)
  const c = 0.15
  material.diffuseColor.set(c * 1.03, c * 1.01, c * 0.97)
  const d = 0.1
  material.emissiveColor.set(d, d, d)
  const e = 0.01
  material.specularColor.set(e, e, e)
  material.specularPower = 10

  // Set diffuse texture
  material.diffuseTexture = config.texture

  // Rendering settings
  material.zOffset = material.zOffsetUnits = 1
  material.backFaceCulling = false // Helps with reflections in the water

  material.freeze()
  material.blockDirtyMechanism = true

  cacheMaterial(cacheKey, material)
  return material
}
