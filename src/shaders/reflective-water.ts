import { Mesh, SceneContext, ShaderMaterial } from '@babylonjs/lite'

interface WaterReflectionMaterialOptions {
  renderTargetSize?: number
  chunkSize?: number
  colorBlendFactor?: number
  colorBlendFactor2?: number
  bumpHeight?: number
  windForce?: number
  windHeading?: number
  waveLength?: number
}

export class ReflectiveWater {
  constructor(_scene: SceneContext, _options: WaterReflectionMaterialOptions = {}) {
    // todo(lite): water reflection shader + mirror texture
  }

  addToReflectionList(_mesh: Mesh): void {}

  removeFromRenderList(_mesh: Mesh): void {}

  clearRenderList(): void {}

  getMaterial(): ShaderMaterial {
    return null as any
  }

  dispose(): void {}
}
