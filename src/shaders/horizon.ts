import fragShader from './horizon.fsh'
import vertShader from './horizon.vsh'

BABYLON.Effect.ShadersStore['horizonVertexShader'] = vertShader
BABYLON.Effect.ShadersStore['horizonFragmentShader'] = fragShader

class HorizonMaterialDefines extends BABYLON.MaterialDefines {
  public CLIPPLANE = false
  public CLIPPLANE2 = false
  public CLIPPLANE3 = false
  public CLIPPLANE4 = false
  public CLIPPLANE5 = false
  public CLIPPLANE6 = false
  public FOG = false
  public IMAGEPROCESSINGPOSTPROCESS = false

  constructor() {
    super()
    this.rebuild()
  }
}

export class HorizonMaterial extends BABYLON.GradientMaterial {
  public isReadyForSubMesh(mesh: BABYLON.AbstractMesh, subMesh: BABYLON.SubMesh, useInstances?: boolean): boolean {
    // @ts-expect-error Accessing Babylon.js private properties for performance optimization
    if (this.isFrozen && subMesh.effect && subMesh.effect._wasPreviouslyReady && subMesh.effect._wasPreviouslyUsingInstances === useInstances) {
      return true
    }

    if (!subMesh.materialDefines) {
      subMesh.materialDefines = new HorizonMaterialDefines()
    }

    const defines = subMesh.materialDefines
    const scene = this.getScene()

    if (this._isReadyForSubMesh(subMesh)) {
      return true
    }

    const engine = scene.getEngine()

    BABYLON.MaterialHelper.PrepareDefinesForFrameBoundValues(scene, engine, this, defines, useInstances ? true : false)

    BABYLON.MaterialHelper.PrepareDefinesForMisc(mesh, scene, false, this.pointsCloud, this.fogEnabled, this.needAlphaTestingForMesh(mesh), defines)

    defines._needNormals = BABYLON.MaterialHelper.PrepareDefinesForLights(scene, mesh, defines, false, 0, true)

    // Attribs
    BABYLON.MaterialHelper.PrepareDefinesForAttributes(mesh, defines, false, true)

    // Get correct effect
    if (defines.isDirty) {
      defines.markAsProcessed()

      scene.resetCachedMaterial()

      // Fallbacks
      const fallbacks = new BABYLON.EffectFallbacks()
      if (defines.FOG) {
        fallbacks.addFallback(1, 'FOG')
      }

      BABYLON.MaterialHelper.HandleFallbacksForShadows(defines, fallbacks)

      defines.IMAGEPROCESSINGPOSTPROCESS = scene.imageProcessingConfiguration.applyByPostProcess

      //Attributes
      const attribs = [BABYLON.VertexBuffer.PositionKind]

      const shaderName = 'horizon'

      const uniforms = ['world', 'view', 'viewProjection', 'vEyePosition', 'vLightsType', 'vFogInfos', 'vFogColor', 'pointSize', 'mBones', 'topColor', 'bottomColor', 'offset', 'smoothness', 'scale']
      BABYLON.AddClipPlaneUniforms(uniforms)
      const samplers: string[] = []
      const uniformBuffers = new Array<string>()

      BABYLON.MaterialHelper.PrepareUniformsAndSamplersList(<BABYLON.IEffectCreationOptions>{
        uniformsNames: uniforms,
        uniformBuffersNames: uniformBuffers,
        samplers: samplers,
        defines: defines,
        maxSimultaneousLights: 4,
      })

      subMesh.setEffect(
        scene.getEngine().createEffect(
          shaderName,
          <BABYLON.IEffectCreationOptions>{
            attributes: attribs,
            uniformsNames: uniforms,
            uniformBuffersNames: uniformBuffers,
            samplers: samplers,
            defines: defines.toString(),
            fallbacks: fallbacks,
            onCompiled: this.onCompiled,
            onError: this.onError,
            indexParameters: { maxSimultaneousLights: 4 },
          },
          engine,
        ),
        defines,
        this._materialContext,
      )
    }
    if (!subMesh.effect || !subMesh.effect.isReady()) {
      return false
    }

    defines._renderId = scene.getRenderId()
    // @ts-expect-error Accessing Babylon.js private properties for performance optimization
    subMesh.effect._wasPreviouslyReady = true
    // @ts-expect-error Accessing Babylon.js private properties for performance optimization
    subMesh.effect._wasPreviouslyUsingInstances = !!useInstances

    return true
  }
}

BABYLON.RegisterClass('BABYLON.HorizonMaterial', HorizonMaterial)
