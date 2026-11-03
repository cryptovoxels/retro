import { afterEach, expect, test, vi } from 'vitest'
import { GraphicEngine, GraphicLevels } from '../src/graphic/graphic-engine'
import { createIslandMaterial } from '../src/materials/island'

vi.mock('../common/helpers/detector', () => ({ isMobile: () => true, isBatterySaver: () => true }))

let engine: BABYLON.NullEngine
afterEach(() => engine?.dispose())

test('mobile uses CSS-pixel resolution even at Ultra on a Retina screen', () => {
  const setHardwareScalingLevel = vi.fn()
  vi.stubGlobal('devicePixelRatio', 3)
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
  const graphics = new GraphicEngine({ setHardwareScalingLevel } as any)
  graphics.setSettings({ level: GraphicLevels.Ultra })
  expect(setHardwareScalingLevel).toHaveBeenLastCalledWith(1)
  vi.unstubAllGlobals()
})

test('mobile island materials do not allocate reflection render targets', () => {
  engine = new BABYLON.NullEngine()
  const scene = new BABYLON.Scene(engine)
  const material = createIslandMaterial(scene, { name: 'mobile-test', texture: new BABYLON.Texture(null, scene) }) as BABYLON.StandardMaterial
  expect(material.reflectionTexture).toBeNull()
  expect(scene.textures.some((texture) => texture instanceof BABYLON.MirrorTexture)).toBe(false)
})
