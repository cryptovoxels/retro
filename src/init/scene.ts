export const createScene = (engine: BABYLON.Engine): BABYLON.Scene => {
  const scene = new BABYLON.Scene(engine, {
    useMaterialMeshMap: true,
    useGeometryUniqueIdsMap: true,
    useClonedMeshMap: true,
  })
  scene.performancePriority = BABYLON.ScenePerformancePriority.BackwardCompatible
  scene.preventDefaultOnPointerDown = false
  scene.preventDefaultOnPointerUp = false
  scene.resetLastAnimationTimeFrame()
  scene.actionManager = new BABYLON.ActionManager(scene)
  scene.autoClear = false
  scene.autoClearDepthAndStencil = false

  return scene
}
