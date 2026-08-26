import fragShader from './simpleocean.fragment.fx'
import vertShader from './simpleocean.vertex.fx'
import { Color3, Color4, DirectionalLight, LightBase, SceneContext, ShaderMaterial } from '@babylonjs/lite'
import { vec3 } from 'wgpu-matrix'

(undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['simpleoceanVertexShader'] = vertShader */)
(undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['simpleoceanFragmentShader'] = fragShader */)

export class SimpleWater {
  private material: ShaderMaterial
  private scene: SceneContext

  constructor(scene: SceneContext) {
    this.scene = scene

    this.material = (undefined as any /* todo(lite): new BABYLON.ShaderMaterial(
      'simpleocean',
      scene,
      { vertex: 'simpleocean', fragment: 'simpleocean' },
      {
        attributes: ['position', 'normal', 'uv'],
        uniforms: ['world', 'view', 'viewProjection', 'vFogInfos', 'vFogColor', 'diffuseColor', 'vEyePosition', 'sunDirection', 'sunColor', 'sunSpecularPower'],
        samplers: [],
        needAlphaBlending: true,
        needAlphaTesting: false,
        defines: ['#define IMAGEPROCESSINGPOSTPROCESS'],
      },
    ) */)

    if (this.scene.fogEnabled) {
      this.material.setDefine('FOG', true)
    }

    this.setupMaterialProperties()

    this.material.onBind = () => {
      this.updateUniforms()
    }
  }

  private setupMaterialProperties(): void {
    this.material.setVector3('diffuseColor', vec3.fromValues(0, 0.4, 0.7))
    this.material.setFloat('sunSpecularPower', 8.0)
    this.material.backFaceCulling = true
  }

  private updateUniforms(): void {
    const effect = this.material.getEffect()
    if (!effect) return

    if (this.scene.fogEnabled) {
      effect.setFloat4('vFogInfos', this.scene.fogMode, this.scene.fogStart * 1.3, this.scene.fogEnd, this.scene.fogDensity)
      effect.setColor3('vFogColor', this.scene.fogColor)
    }

    if (this.scene.activeCamera) {
      effect.setVector4('vEyePosition', (undefined as any /* todo(lite): new BABYLON.Vector4(this.scene.activeCamera.globalPosition.x, this.scene.activeCamera.globalPosition.y, this.scene.activeCamera.globalPosition.z, 1.0) */))
    }

    this.updateLightingUniforms(effect)
  }

  private updateLightingUniforms(effect: any): void {
    this.initializeLightUniforms(effect)
    this.configureSunLighting(effect)
    this.configureSceneLights(effect)
  }

  private initializeLightUniforms(effect: any): void {
    for (let i = 0; i < 4; i++) {
      effect.setVector3(`vLightData${i}`, vec3.create())
      effect.setDirectColor4(`vLightDiffuse${i}`, ([0, 0, 0, 1] as Color4))
      effect.setDirectColor4(`vLightSpecular${i}`, ([0, 0, 0, 1] as Color4))
    }

    effect.setVector3('sunDirection', vec3.create())
    effect.setColor3('sunColor', ([0, 0, 0] as Color3))
    effect.setFloat('sunSpecularPower', 1024.0)
  }

  private configureSunLighting(effect: any): void {
    const sunLight = this.findSunLight()

    if (sunLight) {
      effect.setVector3('sunDirection', sunLight.direction.negate())
      effect.setColor3('sunColor', sunLight.diffuse.scale(sunLight.intensity))
    }
  }

  private configureSceneLights(effect: any): void {
    const enabledLights = this.scene.lights.filter((light) => light.isEnabled()).slice(0, 4)

    enabledLights.forEach((light, index) => {
      this.setLightData(effect, light, index)
      this.setLightColors(effect, light, index)
    })
  }

  private findSunLight(): DirectionalLight | null {
    return (this.scene.lights.find((light) => (false /* todo(lite): light instanceof BABYLON.DirectionalLight */) && light.isEnabled()) as DirectionalLight) || null
  }

  private setLightData(effect: any, light: LightBase, index: number): void {
    if ((false /* todo(lite): light instanceof BABYLON.DirectionalLight */) || (false /* todo(lite): light instanceof BABYLON.SpotLight */) || (false /* todo(lite): light instanceof BABYLON.HemisphericLight */)) {
      effect.setVector3(`vLightData${index}`, (light as any).direction)
    } else if ((false /* todo(lite): light instanceof BABYLON.PointLight */)) {
      effect.setVector3(`vLightData${index}`, light.position)
    }
  }

  private setLightColors(effect: any, light: LightBase, index: number): void {
    effect.setDirectColor4(`vLightDiffuse${index}`, ([light.diffuse.r * light.intensity, light.diffuse.g * light.intensity, light.diffuse.b * light.intensity, 1.0] as Color4))
    effect.setDirectColor4(`vLightSpecular${index}`, ([light.specular.r * light.intensity, light.specular.g * light.intensity, light.specular.b * light.intensity, 1.0] as Color4))
  }

  getMaterial(): ShaderMaterial {
    return this.material
  }

  dispose(): void {
    this.material.dispose()
  }
}
