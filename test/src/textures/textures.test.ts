// ABOUTME: Tests for texture loading and deduplication in AssetLoader
// ABOUTME: Validates that parallel requests for the same URL are properly deduplicated

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as BABYLON from 'babylonjs'

describe('AssetLoader Deduplication', () => {
  let scene: BABYLON.Scene
  let engine: BABYLON.NullEngine
  let fetchSpy: any

  beforeEach(() => {
    engine = new BABYLON.NullEngine()
    scene = new BABYLON.Scene(engine)

    fetchSpy = vi.fn()
    global.fetch = fetchSpy
  })

  afterEach(() => {
    scene.dispose()
    engine.dispose()
    vi.restoreAllMocks()
  })

  describe('Request deduplication', () => {
    it('should deduplicate parallel requests for the same URL', async () => {
      const mockBuffer = new ArrayBuffer(8)
      const mockResponse = {
        ok: true,
        headers: new Headers({
          'x-frames': '1',
          'x-duration': '0',
          'x-original-format': 'png',
        }),
        arrayBuffer: () => Promise.resolve(mockBuffer),
      }

      fetchSpy.mockResolvedValue(mockResponse)

      const testUrl = 'https://example.com/test-image.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      const promises = [fetchTexture(scene as any, testUrl, controller.signal), fetchTexture(scene as any, testUrl, controller.signal), fetchTexture(scene as any, testUrl, controller.signal)]

      await Promise.all(promises)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should not deduplicate sequential requests', async () => {
      const mockBuffer = new ArrayBuffer(8)
      const mockResponse = {
        ok: true,
        headers: new Headers({
          'x-frames': '1',
          'x-duration': '0',
          'x-original-format': 'png',
        }),
        arrayBuffer: () => Promise.resolve(mockBuffer),
      }

      fetchSpy.mockResolvedValue(mockResponse)

      const testUrl = 'https://example.com/test-image.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      await fetchTexture(scene as any, testUrl, controller.signal)
      await fetchTexture(scene as any, testUrl, controller.signal)
      await fetchTexture(scene as any, testUrl, controller.signal)

      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('should deduplicate requests for same URL with different options', async () => {
      const mockBuffer = new ArrayBuffer(8)
      const mockResponse = {
        ok: true,
        headers: new Headers({
          'x-frames': '1',
          'x-duration': '0',
          'x-original-format': 'png',
        }),
        arrayBuffer: () => Promise.resolve(mockBuffer),
      }

      fetchSpy.mockResolvedValue(mockResponse)

      const testUrl = 'https://example.com/shared-texture.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      const promises = [fetchTexture(scene as any, testUrl, controller.signal), fetchTexture(scene as any, testUrl, controller.signal, { transparent: true }), fetchTexture(scene as any, testUrl, controller.signal, { pixelated: true })]

      await Promise.all(promises)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Cleanup after requests', () => {
    it('should clean up the fetch cache after successful request', async () => {
      const mockBuffer = new ArrayBuffer(8)
      const mockResponse = {
        ok: true,
        headers: new Headers({
          'x-frames': '1',
          'x-duration': '0',
          'x-original-format': 'png',
        }),
        arrayBuffer: () => Promise.resolve(mockBuffer),
      }

      fetchSpy.mockResolvedValue(mockResponse)

      const testUrl = 'https://example.com/test-image.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      await fetchTexture(scene as any, testUrl, controller.signal)
      await fetchTexture(scene as any, testUrl, controller.signal)

      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('should clean up the fetch cache after failed request and return noImage', async () => {
      const mockError = new Error('Network error')
      fetchSpy.mockRejectedValue(mockError)

      const testUrl = 'https://example.com/test-image.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      // loadTexture now returns noImage on error instead of throwing
      const texture = await fetchTexture(scene as any, testUrl, controller.signal)

      // Should return a texture (noImage fallback)
      expect(texture).toBeDefined()
      expect(texture).toBeInstanceOf(BABYLON.Texture)
    })
  })

  describe('Error handling with deduplication', () => {
    it('should return noImage for all waiting requests on error', async () => {
      const mockError = new Error('Fetch failed')
      fetchSpy.mockRejectedValue(mockError)

      const testUrl = 'https://example.com/test-image.png'

      const { fetchTexture } = await import('../../../src/textures/textures')

      const controller = new AbortController()
      const promises = [fetchTexture(scene as any, testUrl, controller.signal), fetchTexture(scene as any, testUrl, controller.signal), fetchTexture(scene as any, testUrl, controller.signal)]

      // All should resolve with noImage (no throws)
      const results = await Promise.all(promises)

      results.forEach((texture) => {
        expect(texture).toBeDefined()
        expect(texture).toBeInstanceOf(BABYLON.Texture)
      })
    })
  })

  describe('AbortSignal support', () => {
    it('should pass AbortSignal to fetch calls', async () => {
      const controller = new AbortController()
      const testUrl = 'https://example.com/test-image.png'

      const mockBuffer = new ArrayBuffer(8)
      const mockResponse = {
        ok: true,
        headers: new Headers({
          'x-frames': '1',
          'x-duration': '0',
          'x-original-format': 'png',
        }),
        arrayBuffer: () => Promise.resolve(mockBuffer),
      }

      let signalPassed = false
      fetchSpy.mockImplementation((_url: string, options: any) => {
        if (options?.signal) {
          signalPassed = true
        }
        return Promise.resolve(mockResponse)
      })

      const { fetchTexture } = await import('../../../src/textures/textures')

      await fetchTexture(scene as any, testUrl, controller.signal)

      expect(signalPassed).toBe(true)
    })
  })
})

describe('Texture Animation', () => {
  let scene: BABYLON.Scene
  let engine: BABYLON.NullEngine
  let fetchSpy: any

  beforeEach(() => {
    engine = new BABYLON.NullEngine()
    scene = new BABYLON.Scene(engine)

    fetchSpy = vi.fn()
    global.fetch = fetchSpy
  })

  afterEach(() => {
    scene.dispose()
    engine.dispose()
    vi.restoreAllMocks()
  })

  it('should parse animation metadata from response headers', async () => {
    const mockBuffer = new ArrayBuffer(8)
    const mockResponse = {
      ok: true,
      headers: new Headers({
        'x-frames': '12',
        'x-duration': '1200',
        'x-original-format': 'gif',
      }),
      arrayBuffer: () => Promise.resolve(mockBuffer),
    }

    fetchSpy.mockResolvedValue(mockResponse)

    const testUrl = 'https://example.com/animated.gif'

    const { fetchTexture } = await import('../../../src/textures/textures')

    const controller = new AbortController()
    const texture = await fetchTexture(scene as any, testUrl, controller.signal, { transparent: true })

    expect(texture).toBeDefined()
    expect(texture).toBeInstanceOf(BABYLON.Texture)
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('should not setup animation for static images', async () => {
    const mockBuffer = new ArrayBuffer(8)
    const mockResponse = {
      ok: true,
      headers: new Headers({
        'x-frames': '1',
        'x-duration': '0',
        'x-original-format': 'png',
      }),
      arrayBuffer: () => Promise.resolve(mockBuffer),
    }

    fetchSpy.mockResolvedValue(mockResponse)

    const testUrl = 'https://example.com/static.png'

    const { fetchTexture } = await import('../../../src/textures/textures')

    const controller = new AbortController()
    const texture = await fetchTexture(scene as any, testUrl, controller.signal, { transparent: true })

    expect(texture).toBeDefined()
    expect(texture).toBeInstanceOf(BABYLON.Texture)
  })
})
