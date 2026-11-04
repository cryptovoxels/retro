import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../src/features/feature', () => ({ Feature2D: class {}, TransparencyMode: { Ignore: 'Ignore' } }))
vi.mock('../../web/src/components/editor', () => ({}))
vi.mock('../../src/tools/gizmos', () => ({ rebindGizmos: vi.fn() }))
vi.mock('../../src/ui/features', () => ({ FeatureEditor: class {} }))
vi.mock('../../src/textures/textures', () => ({ fetchTexture: vi.fn() }))

import Image from '../../src/features/image'
import { renderImageDraft } from '../../src/features/feature-draft'
import { fetchTexture } from '../../src/textures/textures'

afterEach(() => vi.restoreAllMocks())

it.each([
  ['', false],
  ['ugc://parcel/6822/YfJx2r.jpg', true],
])('finishes new empty images and only retries real URLs: %s', async (url, retry) => {
  const image = new (Image as any)()
  const texture = { hasAlpha: true }
  vi.mocked(fetchTexture).mockResolvedValue(texture as any)
  Object.assign(image, { url, description: {}, abortController: new AbortController(), generateDraft: vi.fn(), renderImage: vi.fn() })
  await image.generate()
  await image.loading
  expect(fetchTexture).toHaveBeenLastCalledWith(undefined, url || null, expect.any(AbortSignal), expect.objectContaining({ retry }))
  expect(image.loaded).toBe(true)
  expect(image.renderImage).toHaveBeenCalledWith(texture)
})

it('uploads image drafts as opaque RGBA for WebGPU', () => {
  const engine = new BABYLON.NullEngine()
  const scene = new BABYLON.Scene(engine)
  const upload = vi.spyOn(BABYLON.RawTexture, 'CreateRGBATexture')
  const rgb = Uint8Array.from({ length: 48 }, (_, i) => i)
  const feature: any = { scene, uniqueEntityName: (name: string) => name, setCommon: vi.fn() }
  try {
    renderImageDraft(feature, btoa(String.fromCharCode(...rgb)))
    expect(upload).toHaveBeenCalledTimes(1)
    const pixels = upload.mock.calls[0][0] as Uint8Array
    expect(pixels).toHaveLength(64)
    for (let i = 0; i < 16; i++) expect(Array.from(pixels.slice(i * 4, i * 4 + 4))).toEqual([...rgb.slice(i * 3, i * 3 + 3), 255])
    expect(feature.mesh.material.diffuseTexture.format).toBe(BABYLON.Constants.TEXTUREFORMAT_RGBA)
  } finally {
    scene.dispose()
    engine.dispose()
  }
})
