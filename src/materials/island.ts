import { cacheMaterial, generateCacheKey, getCachedMaterial } from './cache'
import { mirrorTexture } from '../utils/mirror'

// one mirror shared by every island, they all sit at the same height
let islandMirror: BABYLON.MirrorTexture | null = null

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
  material.diffuseColor.set(c, c, c)
  const d = 0.1
  material.emissiveColor.set(d, d, d)
  const e = 0.01
  material.specularColor.set(e, e, e)
  material.specularPower = 10

  // Set diffuse texture
  material.diffuseTexture = config.texture

  // Rendering settings
  material.backFaceCulling = false // Helps with reflections in the water

  if (!islandMirror) {
    islandMirror = mirrorTexture(scene, 0.74)
    islandMirror.level = 0.3
    islandMirror.blurKernel = 4
  }
  material.reflectionTexture = islandMirror
  material.reflectionFresnelParameters = new BABYLON.FresnelParameters({ bias: 0.04, power: 3 })

  material.freeze()
  material.blockDirtyMechanism = true

  cacheMaterial(cacheKey, material)
  return material
}
