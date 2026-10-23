import { beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { serverUpload } from '../../compiler/src/upload'
import { contentName } from '../../common/helpers/ugc-upload-keys'

const { send, exists } = vi.hoisted(() => ({ send: vi.fn(), exists: vi.fn() }))
vi.mock('../../server/lib/ugc', () => ({ ugcClient: () => ({ send }), UGC_BUCKET: 'test', ugcExists: exists }))

beforeEach(() => {
  vi.clearAllMocks()
  exists.mockResolvedValue(false)
  send.mockResolvedValue({})
})

it.each([
  [2048, 512, 1024, 256],
  [512, 2048, 256, 1024],
  [320, 160, 320, 160],
])('fits %ix%i inside 1024 without enlargement', async (width, height, expectedWidth, expectedHeight) => {
  const bytes = await sharp({ create: { width, height, channels: 4, background: '#ff000080' } })
    .png()
    .toBuffer()
  const result = await serverUpload(4724, 'original.png', bytes, 'image/png')
  const uploaded = send.mock.calls[0][0].input
  const meta = await sharp(uploaded.Body).metadata()
  expect([meta.width, meta.height, meta.hasAlpha]).toEqual([expectedWidth, expectedHeight, true])
  if (width > 1024 || height > 1024) {
    expect(result?.location).toBe(`ugc://parcel/4724/${await contentName(uploaded.Body)}.png`)
    expect(uploaded.Key).not.toBe('parcel/4724/original.png')
  } else {
    expect(uploaded.Body).toEqual(bytes)
  }
})

it('preserves GIF frames and timing while resizing each frame', async () => {
  const pixels = Buffer.alloc(2048 * 1024 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(i < pixels.length / 2 ? [255, 0, 0, 128] : [0, 255, 0, 128], i)
  const bytes = await sharp(pixels, { raw: { width: 2048, height: 1024, pageHeight: 512, channels: 4 } })
    .gif({ delay: [100, 200], loop: 2 })
    .toBuffer()
  await serverUpload(4724, 'original.gif', bytes, 'image/gif')
  const uploaded = send.mock.calls[0][0].input
  const meta = await sharp(uploaded.Body, { animated: true }).metadata()
  expect([meta.width, meta.pageHeight, meta.pages, meta.delay, meta.loop]).toEqual([1024, 256, 2, [100, 200], 2])
  expect(uploaded.ContentType).toBe('image/gif')
})

it('leaves non-image assets unchanged', async () => {
  const bytes = Buffer.from('VOX ')
  await serverUpload(4724, 'model.vox', bytes, 'application/octet-stream')
  expect(send.mock.calls[0][0].input.Body).toBe(bytes)
})
