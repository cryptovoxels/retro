import fragShader from './horizon.fsh'
import vertShader from './horizon.vsh'
import { Mesh } from '@babylonjs/lite'

(undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['horizonVertexShader'] = vertShader */);
(undefined as any /* todo(lite): BABYLON.Effect.ShadersStore['horizonFragmentShader'] = fragShader */);

class HorizonMaterialDefines extends (Object as any) /* todo(lite): extends BABYLON.MaterialDefines */ {
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

export class HorizonMaterial extends (Object as any) /* todo(lite): extends BABYLON.GradientMaterial */ {
  public isReadyForSubMesh(mesh: Mesh, subMesh: any, useInstances?: boolean): boolean {
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

    (undefined as any /* todo(lite): BABYLON.MaterialHelper.PrepareDefinesForFrameBoundValues(scene, engine, this, defines, useInstances ? true : false) */)

    (undefined as any /* todo(lite): BABYLON.MaterialHelper.PrepareDefinesForMisc(mesh, scene, false, this.pointsCloud, this.fogEnabled, this._shouldTurnAlphaTestOn(mesh), defines) */)

    defines._needNormals = (undefined as any /* todo(lite): BABYLON.MaterialHelper.PrepareDefinesForLights(scene, mesh, defines, false, 0, true) */)

    // Attribs
    (undefined as any /* todo(lite): BABYLON.MaterialHelper.PrepareDefinesForAttributes(mesh, defines, false, true) */)

    // Get correct effect
    if (defines.isDirty) {
      defines.markAsProcessed()

      scene.resetCachedMaterial()

      // Fallbacks
      const fallbacks = (undefined as any /* todo(lite): new BABYLON.EffectFallbacks() */)
      if (defines.FOG) {
        fallbacks.addFallback(1, 'FOG')
      }

      (undefined as any /* todo(lite): BABYLON.MaterialHelper.HandleFallbacksForShadows(defines, fallbacks) */)

      defines.IMAGEPROCESSINGPOSTPROCESS = scene.imageProcessingConfiguration.applyByPostProcess

      //Attributes
      const attribs = [(undefined as any /* todo(lite): BABYLON.VertexBuffer.PositionKind */)]

      const shaderName = 'horizon'

      const uniforms = ['world', 'view', 'viewProjection', 'vEyePosition', 'vLightsType', 'vFogInfos', 'vFogColor', 'pointSize', 'mBones', 'topColor', 'bottomColor', 'offset', 'smoothness', 'scale']
      (undefined as any /* todo(lite): BABYLON.addClipPlaneUniforms(uniforms) */)
      const samplers: string[] = []
      const uniformBuffers = new Array<string>()

      (undefined as any /* todo(lite): BABYLON.MaterialHelper.PrepareUniformsAndSamplersList(<BABYLON.IEffectCreationOptions>{
        uniformsNames: uniforms,
        uniformBuffersNames: uniformBuffers,
        samplers: samplers,
        defines: defines,
        maxSimultaneousLights: 4,
      }) */)

      subMesh.setEffect(
        scene.getEngine().createEffect(
          shaderName,
          <any>{
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

(undefined as any /* todo(lite): BABYLON.RegisterClass('BABYLON.HorizonMaterial', HorizonMaterial) */);
