// ABOUTME: Water material with reflection effects using MirrorTexture
// ABOUTME: Combines the structure of SimpleOceanMaterial with reflection rendering features

import fragShader from './waterreflection.fragment.fx'
import vertShader from './waterreflection.vertex.fx'
import { OCEAN_HEIGHT_OFFSET } from '../constants'
import { WATER_COLOR } from '../enviroments/world-environment-constants'

BABYLON.Effect.ShadersStore['waterreflectionVertexShader'] = vertShader
BABYLON.Effect.ShadersStore['waterreflectionFragmentShader'] = fragShader

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
  private material: BABYLON.ShaderMaterial
  private scene: BABYLON.Scene
  private waterColor: BABYLON.Vector3
  private waterColor2: BABYLON.Vector3
  private chunkSize: number

  private reflectionTexture!: BABYLON.MirrorTexture
  private renderTargets = new BABYLON.SmartArray<BABYLON.RenderTargetTexture>(16)

  private colorBlendFactor: number
  private colorBlendFactor2: number

  private bumpTexture!: BABYLON.Texture
  private bumpHeight: number
  private windForce: number
  private windHeading: number
  private waveLength: number
  private lastTime = 0
  private lastDeltaTime = 0

  private reflectionMatrix: BABYLON.Matrix = BABYLON.Matrix.Zero()
  private waterPlane: BABYLON.Plane

  private reflectionMeshSet = new Set<BABYLON.AbstractMesh>()

  constructor(scene: BABYLON.Scene, options: WaterReflectionMaterialOptions = {}) {
    this.scene = scene
    this.chunkSize = options.chunkSize || 48 // Default to 48 like current terrain
    this.waterColor = BABYLON.Vector3.FromArray(WATER_COLOR.asArray())
    this.waterColor2 = new BABYLON.Vector3(WATER_COLOR.r * 0.7, WATER_COLOR.g * 0.9 + 0.15, WATER_COLOR.b * 0.8 + 0.2)
    this.colorBlendFactor = options.colorBlendFactor || 0.5 // Current ocean.ts default
    this.colorBlendFactor2 = options.colorBlendFactor2 || 0.2 // Current ocean.ts default
    this.bumpHeight = options.bumpHeight || 0.5 // Current ocean.ts default
    this.windForce = options.windForce || 0.1 // Current ocean.ts default
    this.windHeading = options.windHeading || 0.1 // Current ocean.ts default
    this.waveLength = options.waveLength || 2.0 // Current ocean.ts default

    this.waterPlane = BABYLON.Plane.FromPositionAndNormal(new BABYLON.Vector3(0, OCEAN_HEIGHT_OFFSET, 0), new BABYLON.Vector3(0, 1, 0))

    this.createBumpTexture()

    this.createRenderTargets(options.renderTargetSize || 512)

    this.material = new BABYLON.ShaderMaterial(
      'waterreflection',
      scene,
      { vertex: 'waterreflection', fragment: 'waterreflection' },
      {
        attributes: ['position', 'normal', 'uv'],
        uniforms: [
          'world',
          'view',
          'viewProjection',
          'vLightsType',
          'worldReflectionViewProjection',
          'vEyePosition',
          'vFogInfos',
          'vFogColor',
          'waterColor',
          'waterColor2',
          'colorBlendFactor',
          'colorBlendFactor2',
          'vDiffuseColor',
          'vSpecularColor',
          'bumpHeight',
          'windForce',
          'windHeading',
          'waveLength',
          'time',
          'normalMatrix',
        ],
        samplers: ['reflectionSampler', 'bumpSampler'],
        needAlphaBlending: true,
        needAlphaTesting: false,
        defines: ['#define IMAGEPROCESSINGPOSTPROCESS', '#define SPECULARTERM'],
      },
    )

    if (this.scene.fogEnabled) {
      this.material.setDefine('FOG', true)
    }

    this.setupMaterialProperties()

    this.material.getRenderTargetTextures = (): BABYLON.SmartArray<BABYLON.RenderTargetTexture> => {
      this.renderTargets.reset()
      this.renderTargets.push(this.reflectionTexture as BABYLON.RenderTargetTexture)
      return this.renderTargets
    }

    this.material.onBind = (mesh: BABYLON.AbstractMesh) => {
      this.updateUniforms()
      this.bindLights(mesh)
    }
  }

  private createRenderTargets(requestedSize: number): void {
    this.reflectionTexture = new BABYLON.MirrorTexture('waterReflection', requestedSize, this.scene, false)
    this.reflectionTexture.wrapU = BABYLON.Constants.TEXTURE_MIRROR_ADDRESSMODE
    this.reflectionTexture.wrapV = BABYLON.Constants.TEXTURE_MIRROR_ADDRESSMODE
    this.reflectionTexture.ignoreCameraViewport = true
    this.reflectionTexture.mirrorPlane = new BABYLON.Plane(0, -1, 0, OCEAN_HEIGHT_OFFSET)
    this.reflectionTexture.renderList = []
    this.reflectionTexture.refreshRate = 1
    this.scene.customRenderTargets.push(this.reflectionTexture)
  }

  private createBumpTexture(): void {
    this.bumpTexture = new BABYLON.Texture('/textures/waterbump.png', this.scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE)
    this.bumpTexture.anisotropicFilteringLevel = 2

    const baseScale = this.chunkSize / 3
    const uScale = 1
    const vScale = 1
    this.bumpTexture.uScale = baseScale * uScale
    this.bumpTexture.vScale = baseScale * vScale

    this.bumpTexture.wAng = (this.windHeading + 1.0) * Math.PI
  }

  private setupMaterialProperties(): void {
    this.material.setColor4('waterColor', new BABYLON.Color4(this.waterColor.x, this.waterColor.y, this.waterColor.z, 1.0))
    this.material.setColor4('waterColor2', new BABYLON.Color4(this.waterColor2.x, this.waterColor2.y, this.waterColor2.z, 1.0))
    this.material.setFloat('colorBlendFactor', this.colorBlendFactor)
    this.material.setFloat('colorBlendFactor2', this.colorBlendFactor2)
    this.material.setFloat('bumpHeight', this.bumpHeight)

    this.material.setColor4('vDiffuseColor', new BABYLON.Color4(1, 1, 1, 0.95))
    this.material.setColor4('vSpecularColor', new BABYLON.Color4(0, 0, 0, 64.0))
    this.material.setFloat('windForce', this.windForce)
    this.material.setFloat('windHeading', this.windHeading)
    this.material.setFloat('waveLength', this.waveLength)
    this.material.backFaceCulling = false

    this.material.setTexture('reflectionSampler', this.reflectionTexture)
    this.material.setTexture('bumpSampler', this.bumpTexture)

    this.material.setMatrix('normalMatrix', this.bumpTexture.getTextureMatrix())
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

    BABYLON.Matrix.ReflectionToRef(this.waterPlane, this.reflectionMatrix)
    const reflectionWorldViewProjection = this.reflectionMatrix.multiply(this.scene.getViewMatrix()).multiply(this.scene.getProjectionMatrix())

    effect.setMatrix('worldReflectionViewProjection', reflectionWorldViewProjection)

    const deltaTime = this.scene.getEngine().getDeltaTime()
    if (deltaTime !== this.lastDeltaTime) {
      this.lastDeltaTime = deltaTime
      this.lastTime += this.lastDeltaTime
    }
    effect.setFloat('time', this.lastTime / 100000)
  }

  private bindLights(mesh: BABYLON.AbstractMesh): void {
    const effect = this.material.getEffect()
    if (!effect) return

    if (this.scene.lightsEnabled) {
      BABYLON.MaterialHelper.BindLights(this.scene, mesh, effect, { SPECULARTERM: true } as any, 4)
    }
  }

  addToReflectionList(mesh: BABYLON.AbstractMesh): void {
    if (!this.reflectionMeshSet.has(mesh)) {
      this.reflectionMeshSet.add(mesh)
      if (this.reflectionTexture.renderList) {
        this.reflectionTexture.renderList.push(mesh)
      }
    }
  }

  removeFromRenderList(mesh: BABYLON.AbstractMesh): void {
    if (this.reflectionMeshSet.delete(mesh) && this.reflectionTexture.renderList) {
      const reflectionIndex = this.reflectionTexture.renderList.indexOf(mesh)
      if (reflectionIndex !== -1) {
        this.reflectionTexture.renderList.splice(reflectionIndex, 1)
      }
    }
  }

  clearRenderList(): void {
    this.reflectionMeshSet.clear()
    if (this.reflectionTexture.renderList) {
      this.reflectionTexture.renderList.length = 0
    }
  }

  getMaterial(): BABYLON.ShaderMaterial {
    return this.material
  }

  dispose(): void {
    const reflectionIndex = this.scene.customRenderTargets.indexOf(this.reflectionTexture as BABYLON.RenderTargetTexture)
    if (reflectionIndex !== -1) {
      this.scene.customRenderTargets.splice(reflectionIndex, 1)
    }

    this.reflectionMeshSet.clear()

    this.reflectionTexture.dispose()
    this.bumpTexture.dispose()
    this.material.dispose()
  }
}
