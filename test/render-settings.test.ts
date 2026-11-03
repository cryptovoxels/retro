import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { GraphicEngine, GraphicLevels } from '../src/graphic/graphic-engine'

const engine = { setHardwareScalingLevel: vi.fn() } as any
beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  BABYLON.MaterialFlags.ReflectionTextureEnabled = true
})

test('old settings default reflections and opacity sorting to off', () => {
  localStorage.setItem('graphicSettings', JSON.stringify({ level: GraphicLevels.High }))
  const graphics = new GraphicEngine(engine)
  graphics.start()
  expect(graphics.getSettings()).toEqual({ level: GraphicLevels.High, reflections: false, opacitySorting: false })
  expect(BABYLON.MaterialFlags.ReflectionTextureEnabled).toBe(false)
})

test('settings persist and restore both options', () => {
  const graphics = new GraphicEngine(engine)
  graphics.setSettings({ level: GraphicLevels.Medium, reflections: true, opacitySorting: true })
  const restored = new GraphicEngine(engine)
  restored.start()
  expect(restored.getSettings()).toEqual(graphics.getSettings())
  expect(BABYLON.MaterialFlags.ReflectionTextureEnabled).toBe(true)
})

test('sorting off renders in submission order without distance calculations', () => {
  const graphics = new GraphicEngine(engine)
  graphics.setSettings({ level: GraphicLevels.Medium })
  const rendered: number[] = []
  const bounds = vi.fn(() => ({ boundingSphere: { centerWorld: BABYLON.Vector3.Zero() } }))
  const data = [2, 1].map((order) => ({
    order,
    getMesh: () => ({ getScene: () => ({}), alphaIndex: 0 }),
    getBoundingInfo: bounds,
    getMaterial: () => null,
    render: (transparent: boolean) => {
      expect(transparent).toBe(true)
      rendered.push(order)
    },
  }))
  const compare = vi.fn((a, b) => a.order - b.order)
  const draw = () => (BABYLON.RenderingGroup as any)._RenderSorted({ data, length: data.length }, compare, null, true, false)
  draw()
  expect(rendered).toEqual([2, 1])
  expect(compare).not.toHaveBeenCalled()
  expect(bounds).not.toHaveBeenCalled()
  graphics.setSettings({ level: GraphicLevels.Medium, opacitySorting: true })
  rendered.length = 0
  draw()
  expect(rendered).toEqual([1, 2])
  expect(compare).toHaveBeenCalled()
})
