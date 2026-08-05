import fragShader from './simpleocean.fragment.fx'
import vertShader from './simpleocean.vertex.fx'

BABYLON.Effect.ShadersStore['simpleoceanVertexShader'] = vertShader
BABYLON.Effect.ShadersStore['simpleoceanFragmentShader'] = fragShader

export class SimpleWater {
  private material: BABYLON.ShaderMaterial
  private scene: BABYLON.Scene

  constructor(scene: BABYLON.Scene) {
    this.scene = scene

    this.material = new BABYLON.ShaderMaterial(
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
    )

    if (this.scene.fogEnabled) {
      this.material.setDefine('FOG', true)
    }

    this.setupMaterialProperties()

    this.material.onBind = () => {
      this.updateUniforms()
    }
  }

  private setupMaterialProperties(): void {
    this.material.setVector3('diffuseColor', new BABYLON.Vector3(0, 0.4, 0.7))
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
      effect.setVector4('vEyePosition', new BABYLON.Vector4(this.scene.activeCamera.globalPosition.x, this.scene.activeCamera.globalPosition.y, this.scene.activeCamera.globalPosition.z, 1.0))
    }

    this.updateLightingUniforms(effect)
  }

  private updateLightingUniforms(effect: BABYLON.Effect): void {
    this.initializeLightUniforms(effect)
    this.configureSunLighting(effect)
    this.configureSceneLights(effect)
  }

  private initializeLightUniforms(effect: BABYLON.Effect): void {
    for (let i = 0; i < 4; i++) {
      effect.setVector3(`vLightData${i}`, BABYLON.Vector3.Zero())
      effect.setDirectColor4(`vLightDiffuse${i}`, new BABYLON.Color4(0, 0, 0, 1))
      effect.setDirectColor4(`vLightSpecular${i}`, new BABYLON.Color4(0, 0, 0, 1))
    }

    effect.setVector3('sunDirection', BABYLON.Vector3.Zero())
    effect.setColor3('sunColor', new BABYLON.Color3(0, 0, 0))
    effect.setFloat('sunSpecularPower', 1024.0)
  }

  private configureSunLighting(effect: BABYLON.Effect): void {
    const sunLight = this.findSunLight()

    if (sunLight) {
      effect.setVector3('sunDirection', sunLight.direction.negate())
      effect.setColor3('sunColor', sunLight.diffuse.scale(sunLight.intensity))
    }
  }

  private configureSceneLights(effect: BABYLON.Effect): void {
    const enabledLights = this.scene.lights.filter((light) => light.isEnabled()).slice(0, 4)

    enabledLights.forEach((light, index) => {
      this.setLightData(effect, light, index)
      this.setLightColors(effect, light, index)
    })
  }

  private findSunLight(): BABYLON.DirectionalLight | null {
    return (this.scene.lights.find((light) => light instanceof BABYLON.DirectionalLight && light.isEnabled()) as BABYLON.DirectionalLight) || null
  }

  private setLightData(effect: BABYLON.Effect, light: BABYLON.Light, index: number): void {
    if (light instanceof BABYLON.DirectionalLight || light instanceof BABYLON.SpotLight || light instanceof BABYLON.HemisphericLight) {
      effect.setVector3(`vLightData${index}`, (light as any).direction)
    } else if (light instanceof BABYLON.PointLight) {
      effect.setVector3(`vLightData${index}`, light.position)
    }
  }

  private setLightColors(effect: BABYLON.Effect, light: BABYLON.Light, index: number): void {
    effect.setDirectColor4(`vLightDiffuse${index}`, new BABYLON.Color4(light.diffuse.r * light.intensity, light.diffuse.g * light.intensity, light.diffuse.b * light.intensity, 1.0))
    effect.setDirectColor4(`vLightSpecular${index}`, new BABYLON.Color4(light.specular.r * light.intensity, light.specular.g * light.intensity, light.specular.b * light.intensity, 1.0))
  }

  getMaterial(): BABYLON.ShaderMaterial {
    return this.material
  }

  dispose(): void {
    this.material.dispose()
  }
}
