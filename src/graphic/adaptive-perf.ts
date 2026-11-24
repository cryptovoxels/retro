import { batch, effect, signal } from '@preact/signals'
import { isBatterySaver, isOculusQuest } from '../../common/helpers/detector'
import { GraphicLevels, type GraphicEngine } from './graphic-engine'

export class AdaptivePerf {
  static readonly cpuBound = signal(1)
  static readonly gpuBound = signal(1)
  static readonly gpuMeasured = signal(false)
  static readonly resolution = signal(1)

  constructor(scene: BABYLON.Scene, graphic: GraphicEngine) {
    const engine = scene.getEngine()
    const additions = new Uint32Array(4)
    const buckets = new Float64Array(4)
    const added = scene.onNewMeshAddedObservable.add(() => {
      const bucket = Math.floor(performance.now() / 250)
      const slot = bucket % additions.length
      if (buckets[slot] !== bucket) additions[slot] = 0
      buckets[slot] = bucket
      additions[slot]++
    })
    const timing = new BABYLON.EngineInstrumentation(engine)
    timing.captureGPUFrameTime = true
    const gpu = timing.gpuFrameTimeCounter
    let started = 0
    let frames = 0
    let slow = 0
    let cpuTime = 0
    let frameTime = 0
    let gpuTime = 0
    let gpuFrames = 0
    let gpuCount = gpu.count
    const begin = engine.onBeginFrameObservable.add(() => (started = performance.now()))
    const end = engine.onEndFrameObservable.add(() => {
      const bucket = Math.floor(performance.now() / 250)
      let total = 0
      for (let i = 0; i < additions.length; i++) {
        const age = bucket - buckets[i]
        if (age >= additions.length) continue
        total += additions[i]
      }
      if (document.hidden || total > 4) {
        frames = slow = cpuTime = frameTime = gpuTime = gpuFrames = 0
        gpuCount = gpu.count
        return
      }
      cpuTime += performance.now() - started
      frameTime += engine.getDeltaTime()
      if (engine.getDeltaTime() > 16) slow++
      // GPU queries arrive asynchronously. Never count the same result twice.
      if (gpu.count !== gpuCount) {
        gpuCount = gpu.count
        if (gpu.current > 0) {
          gpuTime += gpu.current / 1e6
          gpuFrames++
        }
      }
      if (++frames < 120) return
      const cpu = cpuTime / frames / 16
      // Without timestamps, cheap CPU frames plus missed deadlines suggest GPU pressure.
      // This also includes browser/compositor scheduling; it is not a GPU measurement.
      // A 60 Hz display delivers healthy frames at 16.67 ms; do not blame vsync on the GPU.
      const gpuLoad = gpuFrames ? gpuTime / gpuFrames / 16 : cpu < 1 && frameTime / frames > 18 ? frameTime / frames / 16 : 1
      batch(() => {
        AdaptivePerf.cpuBound.value = Math.max(1, cpu)
        AdaptivePerf.gpuBound.value = Math.max(1, gpuLoad)
        AdaptivePerf.gpuMeasured.value = gpuFrames > 0
        if (slow >= 60 && gpuLoad > 1 && AdaptivePerf.resolution.value > 1 / 8) AdaptivePerf.resolution.value /= 2
      })
      frames = slow = cpuTime = frameTime = gpuTime = gpuFrames = 0
    })
    const resize = () => {
      const ratio = isOculusQuest() || isBatterySaver() || graphic.level <= GraphicLevels.Medium ? 1 : Math.min(2, window.devicePixelRatio || 1)
      engine.setHardwareScalingLevel(1 / (ratio * AdaptivePerf.resolution.value))
      if (AdaptivePerf.resolution.value < 1) graphic.postProcesses?.dropAA()
    }
    const stop = effect(resize)
    graphic.addEventListener('settingsChanged', resize)
    engine.onDisposeObservable.addOnce(() => {
      stop()
      graphic.removeEventListener('settingsChanged', resize)
      engine.onBeginFrameObservable.remove(begin)
      engine.onEndFrameObservable.remove(end)
      scene.onNewMeshAddedObservable.remove(added)
      timing.dispose()
    })
  }
}
