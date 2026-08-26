import { createSceneContext, EngineContext, SceneContext, onBeforeRender } from '@babylonjs/lite'

export const createScene = (engine: EngineContext): SceneContext => {
  const scene = createSceneContext(engine)
  patchBjsScene(engine, scene)
  return scene
}

function renderObservable() {
  const cbs = new Set<() => void>()
  const once = new Set<() => void>()
  return {
    add: (cb: () => void) => {
      cbs.add(cb)
      return cb
    },
    remove: (cb: () => void) => {
      cbs.delete(cb)
    },
    removeCallback: (cb: () => void) => {
      cbs.delete(cb)
    },
    addOnce: (cb: () => void) => {
      once.add(cb)
    },
    fire: () => {
      cbs.forEach((cb) => cb())
      once.forEach((cb) => cb())
      once.clear()
    },
  }
}

/** BJS scene/engine shims until call sites are ported to lite. */
function patchBjsScene(engine: EngineContext, scene: SceneContext) {
  const canvas = scene.surface.canvas as HTMLCanvasElement
  let deltaMs = 1000 / 60
  let frameId = 0
  const beforeRender = renderObservable()
  const afterRender = renderObservable()

  onBeforeRender(scene, (dt) => {
    frameId++
    deltaMs = dt || 1000 / 60
    beforeRender.fire()
    afterRender.fire()
  })

  const noopSub = () => () => {}
  const noopObs = { add: noopSub, remove: () => {}, addOnce: noopSub }
  const s = scene as any

  s.getEngine = () => ({
    ...engine,
    canvas,
    getDeltaTime: () => deltaMs,
    getRenderingCanvas: () => canvas,
    getInputElementClientRect: () => canvas.getBoundingClientRect(),
    getRenderWidth: () => canvas.width,
    getRenderHeight: () => canvas.height,
    getHardwareScalingLevel: () => {
      const dpr = window.devicePixelRatio || 1
      const max = scene.surface.maxDevicePixelRatio ?? Infinity
      return 1 / Math.min(dpr, max)
    },
    getFps: () => 1000 / deltaMs,
    onCanvasBlurObservable: noopObs,
    onResizeObservable: noopObs,
    runRenderLoop: () => {},
    stopRenderLoop: () => {},
    createEffect: () => null,
    resize: () => {},
  })

  Object.defineProperty(scene, 'activeCamera', {
    get: () => scene.camera,
    set: (v) => {
      scene.camera = v
    },
    configurable: true,
  })

  s.onBeforeRenderObservable = beforeRender
  s.onAfterRenderObservable = afterRender
  s.getFrameId = () => frameId
  s.textures = []
  s.preventDefaultOnPointerDown = false
  s.preventDefaultOnPointerUp = false
  s.pointerMovePredicate = undefined
}
