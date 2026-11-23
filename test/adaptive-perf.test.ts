import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AdaptivePerf } from '../src/graphic/adaptive-perf'

beforeEach(() => {
  AdaptivePerf.cpuBound.value = AdaptivePerf.gpuBound.value = AdaptivePerf.resolution.value = 1
  AdaptivePerf.gpuMeasured.value = false
})
afterEach(() => vi.restoreAllMocks())

function harness() {
  const gpu = { count: 0, current: 0 }
  const timing = { gpuFrameTimeCounter: gpu, captureGPUFrameTime: false, dispose: vi.fn() }
  vi.spyOn(BABYLON, 'EngineInstrumentation').mockImplementation(function () {
    return timing as any
  })
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const engine = {
    onBeginFrameObservable: new BABYLON.Observable(),
    onEndFrameObservable: new BABYLON.Observable(),
    onDisposeObservable: new BABYLON.Observable(),
    getDeltaTime: () => 32,
    setHardwareScalingLevel: vi.fn(),
  }
  const graphic = { level: 1, postProcesses: { dropAA: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const scene = { getEngine: () => engine, onNewMeshAddedObservable: new BABYLON.Observable() }
  new AdaptivePerf(scene as any, graphic as any)
  return {
    add(count: number) {
      for (let i = 0; i < count; i++) scene.onNewMeshAddedObservable.notifyObservers(null)
    },
    advance(ms: number) {
      now += ms
    },
    engine,
    timing,
    graphic,
    sample(cpu: number, gpuMs?: number) {
      for (let i = 0; i < 120; i++) {
        engine.onBeginFrameObservable.notifyObservers(null)
        now += cpu
        if (gpuMs !== undefined) {
          gpu.count++
          gpu.current = gpuMs * 1e6
        }
        engine.onEndFrameObservable.notifyObservers(null)
      }
    },
    dispose() {
      engine.onDisposeObservable.notifyObservers(null)
    },
  }
}

test('CPU pressure does not lower resolution when GPU is within budget', () => {
  const h = harness()
  h.sample(24, 8)
  expect(AdaptivePerf.cpuBound.value).toBe(1.5)
  expect(AdaptivePerf.gpuBound.value).toBe(1)
  expect(AdaptivePerf.gpuMeasured.value).toBe(true)
  expect(AdaptivePerf.resolution.value).toBe(1)
  h.dispose()
})

test('GPU pressure lowers resolution and disables AA, bounded at one eighth', () => {
  const h = harness()
  h.sample(4, 32)
  expect(AdaptivePerf.cpuBound.value).toBe(1)
  expect(AdaptivePerf.gpuBound.value).toBe(2)
  expect(AdaptivePerf.resolution.value).toBe(0.5)
  expect(h.graphic.postProcesses.dropAA).toHaveBeenCalled()
  h.sample(4, 32)
  h.sample(4, 32)
  h.sample(4, 32)
  expect(AdaptivePerf.resolution.value).toBe(0.125)
  expect(h.engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(8)
  h.dispose()
  expect(h.timing.dispose).toHaveBeenCalledOnce()
})

test('missing GPU timers are marked estimated and stale results are not reused', () => {
  const h = harness()
  h.sample(4, 32)
  h.sample(24)
  expect(AdaptivePerf.gpuMeasured.value).toBe(false)
  expect(AdaptivePerf.cpuBound.value).toBe(1.5)
  expect(AdaptivePerf.gpuBound.value).toBe(1)
  expect(AdaptivePerf.resolution.value).toBe(0.5)
  h.dispose()
})

test('hidden frames do not publish pressure or reduce resolution', () => {
  const h = harness()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  h.sample(50, 50)
  expect(AdaptivePerf.cpuBound.value).toBe(1)
  expect(AdaptivePerf.gpuBound.value).toBe(1)
  expect(AdaptivePerf.resolution.value).toBe(1)
  h.dispose()
})

test('import bursts discard samples until the circular activity buffer clears', () => {
  const h = harness()
  h.add(30)
  h.sample(4, 32)
  expect(AdaptivePerf.resolution.value).toBe(1)
  expect(AdaptivePerf.gpuMeasured.value).toBe(false)
  h.advance(1000)
  h.sample(4, 32)
  expect(AdaptivePerf.resolution.value).toBe(0.5)
  h.dispose()
})
