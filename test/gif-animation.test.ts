import { expect, test, vi } from 'vitest'
import { metadataFromResponse } from '../src/textures/metadata-cache'
import { initializeTextureAnimation, registerAnimation } from '../src/textures/animation'

test('redirect metadata drives all 16 cells and wraps at the full duration', () => {
  const frames = { frames: 16, duration: 1600, columns: 4, rows: 4 }
  const metadata = metadataFromResponse({ url: `https://texture.voxels.com/sheet.ktx?frames=${encodeURIComponent(JSON.stringify(frames))}`, headers: new Headers() } as Response)
  const scene = { onBeforeRenderObservable: new BABYLON.Observable() } as BABYLON.Scene
  const texture = { onDisposeObservable: new BABYLON.Observable() } as BABYLON.Texture
  initializeTextureAnimation(scene)
  registerAnimation(metadata, texture)
  const now = vi.spyOn(BABYLON.PrecisionDate, 'Now', 'get')
  try {
    for (let frame = 0; frame <= 16; frame++) {
      now.mockReturnValue(frame * 100)
      scene.onBeforeRenderObservable.notifyObservers(scene)
      expect([texture.uScale, texture.vScale]).toEqual([0.25, 0.25])
      expect(texture.uOffset).toBe((frame % 4) / 4)
      expect(texture.vOffset).toBe(0.75 - Math.floor((frame % 16) / 4) / 4)
    }
    texture.onDisposeObservable.notifyObservers(texture)
    now.mockReturnValue(500)
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(texture.uOffset).toBe(0)
  } finally {
    now.mockRestore()
  }
})
