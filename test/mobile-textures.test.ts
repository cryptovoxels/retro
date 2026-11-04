import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fetchTexture } from '../src/textures/textures'
import { getGpuTextureFormat } from '../src/textures/gpu'
import { isMobile } from '../common/helpers/detector'

vi.mock('../common/helpers/detector', () => ({ isMobile: vi.fn() }))
vi.mock('../src/textures/animation', () => ({ registerAnimation: vi.fn() }))
vi.mock('../src/textures/gpu', () => ({ getGpuTextureFormat: vi.fn() }))

vi.hoisted(() => window.history.replaceState({}, '', '?textureFunction=0'))

const originalBabylon = BABYLON
let scene: BABYLON.Scene
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.mocked(isMobile).mockReturnValue(true)
  vi.mocked(getGpuTextureFormat).mockReturnValue('.pvrtc.ktx')
  scene = {} as BABYLON.Scene
  class Texture {
    static TRILINEAR_SAMPLINGMODE = 3
    onDisposeObservable = new originalBabylon.Observable()
    constructor(
      public url: string,
      _scene: any,
      _noMips: boolean,
      _flip: boolean,
      _sampling: number,
      loaded: () => void,
    ) {
      queueMicrotask(loaded)
    }
    getSize() {
      return { width: 256, height: 256 }
    }
    dispose() {
      this.onDisposeObservable.notifyObservers(this)
    }
  }
  vi.stubGlobal('BABYLON', { ...originalBabylon, Texture })
  fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(8) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.stubEnv('TEXTURE_HOST', 'https://compressor.example')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test('UGC originals are replaced by the 256px endpoint', async () => {
  await fetchTexture(scene, 'ugc://parcel/1/large.png', new AbortController().signal)
  expect(fetchMock.mock.calls[0][0]).toBe('https://compressed.voxels.com/parcel/1/large.png')
})

test('ASTC-capable phones request GPU-compressed UGC textures', async () => {
  vi.mocked(getGpuTextureFormat).mockReturnValue('.astc.ktx')
  await fetchTexture(scene, 'ugc://parcel/1/large.png', new AbortController().signal)
  expect(fetchMock.mock.calls[0][0]).toBe('https://compressed.voxels.com/parcel/1/large.png?hint=.astc.ktx')
})

test.each(['ugc://parcel/1/large.jpg', 'https://ugc.voxels.com/parcel/1/large.jpg'])('desktop compresses UGC instead of decoding originals: %s', async (source) => {
  vi.mocked(isMobile).mockReturnValue(false)
  vi.mocked(getGpuTextureFormat).mockReturnValue('.astc.ktx')
  await fetchTexture(scene, source, new AbortController().signal)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const url = new URL(fetchMock.mock.calls[0][0])
  expect(url.origin).toBe('https://compressor.example')
  expect(url.searchParams.get('url')).toBe('https://ugc.voxels.com/parcel/1/large.jpg')
  expect(url.searchParams.get('hint')).toBe('.astc.ktx')
})

test('other images request 256px and one GIF frame', async () => {
  await fetchTexture(scene, 'https://example.com/animated.gif', new AbortController().signal)
  const url = new URL(fetchMock.mock.calls[0][0])
  expect(url.searchParams.get('size')).toBe('256')
  expect(url.searchParams.get('gif')).toBe('first')
})

test('the image budget stops downloads and disposal makes room again', async () => {
  const textures: BABYLON.Texture[] = []
  const signal = new AbortController().signal
  for (let i = 0; i < 220; i++) textures.push(await fetchTexture(scene, `ugc://parcel/1/${i}.png`, signal))
  const count = fetchMock.mock.calls.length
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(193)
  textures[0].dispose()
  await fetchTexture(scene, 'ugc://parcel/1/new.png', signal)
  expect(fetchMock).toHaveBeenCalledTimes(count + 1)
})

test.each([true, false])('image failures keep the draft pending and retry every 30 seconds (mobile=%s)', async (mobile) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.mocked(isMobile).mockReturnValue(mobile)
  fetchMock.mockResolvedValue({ ok: false, status: 503, headers: new Headers() })
  const controller = new AbortController()
  let loaded = false
  try {
    const pending = fetchTexture(scene, 'ugc://parcel/1/retry.png', controller.signal, { retry: true }).then((texture) => {
      loaded = true
      return texture
    })
    await vi.advanceTimersByTimeAsync(0)
    const count = fetchMock.mock.calls.length
    expect(count).toBeGreaterThan(0)
    expect(loaded).toBe(false)
    await vi.advanceTimersByTimeAsync(29999)
    expect(fetchMock).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(count * 2)
    expect(loaded).toBe(false)
    fetchMock.mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(8) })
    await vi.advanceTimersByTimeAsync(30000)
    const texture = await pending
    expect(loaded).toBe(true)
    expect((texture as any).url).not.toContain('no-image')
    texture.dispose()
  } finally {
    controller.abort()
    vi.useRealTimers()
  }
})

test('removing an image cancels its pending retry', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fetchMock.mockRejectedValue(new Error('compressor unavailable'))
  const controller = new AbortController()
  try {
    const pending = fetchTexture(scene, 'ugc://parcel/1/cancel.png', controller.signal, { retry: true })
    const rejected = expect(pending).rejects.toBe('removed')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort('removed')
    await rejected
    await vi.advanceTimersByTimeAsync(60000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    controller.abort()
    vi.useRealTimers()
  }
})

test.each(['60', new Date(Date.now() + 60000).toUTCString()])('honours Retry-After: %s', async (retry) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const controller = new AbortController()
  fetchMock.mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'Retry-After': retry }) })
  const pending = fetchTexture(scene, 'ugc://parcel/1/busy.png', controller.signal, { retry: true })
  const rejected = expect(pending).rejects.toBe('removed')
  try {
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(58000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    controller.abort('removed')
    await rejected
  } finally {
    controller.abort('removed')
    vi.useRealTimers()
  }
})

test.each([true, false])('UGC Function is enabled by default and falls back when unavailable (failure=%s)', async (failure) => {
  vi.resetModules()
  vi.stubGlobal('window', { location: { search: '' } })
  vi.mocked(getGpuTextureFormat).mockReturnValue('.astc.ktx')
  if (failure) fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers({ 'Retry-After': '30' }) })
  const trial = await import('../src/textures/textures')
  await trial.fetchTexture(scene, 'ugc://parcel/6822/YfJx2r.jpg', new AbortController().signal, { stretch: false })
  const url = new URL(fetchMock.mock.calls[0][0])
  expect(url.hostname).toBe('faas-sfo3-7872a1dd.doserverless.co')
  expect(Object.fromEntries(url.searchParams)).toEqual({ key: 'parcel/6822/YfJx2r.jpg', width: '256', height: '256', fit: 'cover', format: 'astc', hint: '.astc.ktx' })
  expect(fetchMock).toHaveBeenCalledTimes(failure ? 2 : 1)
  if (failure) expect(fetchMock.mock.calls[1][0]).toBe('https://compressed.voxels.com/parcel/6822/YfJx2r.jpg?hint=.astc.ktx')
})
