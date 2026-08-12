// ABOUTME: Test setup file for Vitest using real BABYLON.js instead of mocks
// ABOUTME: Provides proper Babylon.js environment for testing with jsdom

import 'babylonjs-loaders'
import 'babylonjs-materials'
import 'babylonjs'

BABYLON.Logger.LogLevels = BABYLON.Logger.NoneLogLevel

// Mock performance API if not available
if (typeof performance === 'undefined') {
  global.performance = {
    now: () => Date.now(),
    mark: () => {},
    measure: () => {},
    getEntriesByName: () => [],
    getEntriesByType: () => [],
    clearMarks: () => {},
    clearMeasures: () => {},
  } as any
}

// Mock navigator.hardwareConcurrency
Object.defineProperty(global.navigator, 'hardwareConcurrency', {
  value: 4,
  writable: true,
})

// Mock URL constructor for worker scripts
if (typeof URL === 'undefined') {
  global.URL = class MockURL {
    constructor(public url: string) {}
    toString() {
      return this.url
    }
  } as any
}

// Mock Worker for web workers
if (typeof Worker === 'undefined') {
  global.Worker = class MockWorker {
    constructor(public url: string | URL) {}
    postMessage(data: any) {}
    terminate() {}
    addEventListener(type: string, listener: any) {}
    removeEventListener(type: string, listener: any) {}
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null
  } as any
}

// Common test utilities using real BABYLON.js
export const createMockEngine = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  document.body.appendChild(canvas)

  // Create a real Babylon.js engine with NullEngine (headless)
  const engine = new BABYLON.NullEngine({
    renderWidth: 800,
    renderHeight: 600,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  })

  return engine
}

export const createMockScene = () => {
  const engine = createMockEngine()
  const scene = new BABYLON.Scene(engine)

  // Create a basic camera
  const camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 0, 0), scene)
  camera.setTarget(BABYLON.Vector3.Zero())
  scene.activeCamera = camera

  return scene
}

export const createMockParcel = (id = 1) => ({
  id,
  transform: {
    position: new BABYLON.Vector3(0, 0, 0),
  },
  featuresList: [],
  createFeature: async () => ({
    uuid: 'test-feature-uuid',
    dispose: () => {},
    description: {},
  }),
  grid: {
    currentParcel: () => ({ id }),
  },
})

export const createMockFeature = (type = 'cube', uuid = 'test-uuid') => ({
  type,
  uuid,
  position: [0, 0, 0],
  scale: [1, 1, 1],
  rotation: [0, 0, 0],
})

// Test timeout constants
export const INTEGRATION_TEST_TIMEOUT = 30000
export const UNIT_TEST_TIMEOUT = 5000
