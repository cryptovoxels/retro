import { EngineContext, SceneContext } from '@babylonjs/lite'
export const createScene = (engine: EngineContext): SceneContext => {
  const scene = (undefined as any /* todo(lite): new BABYLON.Scene(engine, {
    useMaterialMeshMap: true,
    useGeometryUniqueIdsMap: true,
    useClonedMeshMap: true,
  }) */)
  scene.performancePriority = (undefined as any /* todo(lite): BABYLON.ScenePerformancePriority.BackwardCompatible */)
  scene.preventDefaultOnPointerDown = false
  scene.preventDefaultOnPointerUp = false
  scene.resetLastAnimationTimeFrame()
  scene.actionManager = (undefined as any /* todo(lite): new BABYLON.ActionManager(scene) */)
  scene.autoClear = false
  scene.autoClearDepthAndStencil = false

  return scene
}
