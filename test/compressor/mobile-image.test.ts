import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { pack } from '../../compressor/src/utils'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { ugcClient } from '../../server/lib/ugc'
import { beforeEach } from 'vitest'
import { access, writeFile } from 'node:fs/promises'
import { mobileImage } from '../../compressor/src/mobile'

vi.mock('../../compressor/src/utils', async (original) => ({ ...(await original<any>()), pack: vi.fn() }))
vi.mock('../../server/lib/ugc', () => ({ ugcClient: vi.fn(), UGC_BUCKET: 'voxels-ugc' }))
let upload: any
let send: any
beforeEach(() => {
  upload = undefined
  send = vi.fn(async (command: any) => {
    if (command instanceof HeadObjectCommand) throw { name: 'NotFound' }
    if (command instanceof PutObjectCommand) upload = command.input
  })
  vi.mocked(ugcClient).mockReturnValue({ send } as any)
})
afterEach(() => vi.unstubAllGlobals())

function response() {
  const res: any = { status: 200, headers: {} }
  res.set = (key: string, value: string) => {
    res.headers[key] = value
    return res
  }
  res.type = (type: string) => {
    res.contentType = type
    return res
  }
  res.redirect = (status: number, url: string) => {
    res.status = status
    res.location = url
    return res
  }
  res.send = (body: Buffer) => {
    res.body = body
    return res
  }
  res.sendStatus = (status: number) => {
    res.status = status
    return res
  }
  return res
}

it.each([
  [2048, 512, 256, 64],
  [512, 2048, 64, 256],
  [32, 16, 32, 16],
])('resizes %ix%i without enlargement', async (width, height, expectedWidth, expectedHeight) => {
  const bytes = await sharp({ create: { width, height, channels: 4, background: '#ff000080' } })
    .png()
    .toBuffer()
  const fetch = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetch)
  const res = response()
  await mobileImage({ params: {}, query: { key: `parcel/1/${width}.png` } } as any, res)
  const metadata = await sharp(upload.Body).metadata()
  expect([metadata.width, metadata.height, metadata.hasAlpha, metadata.format]).toEqual([expectedWidth, expectedHeight, true, 'webp'])
  expect(res.headers['Cache-Control']).toContain('max-age=31536000')
  expect(fetch.mock.calls[0][0]).toBe(`https://ugc.voxels.com/parcel/1/${width}.png`)
  expect(fetch.mock.calls[0][1].redirect).toBe('error')
})

it('uses only the first GIF frame', async () => {
  const bytes = await sharp(Buffer.alloc(512 * 1024 * 4, 128), { raw: { width: 512, height: 1024, pageHeight: 512, channels: 4 } })
    .gif({ delay: [100, 200] })
    .toBuffer()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)))
  const res = response()
  await mobileImage({ params: {}, query: { key: 'image.gif' } } as any, res)
  const metadata = await sharp(upload.Body, { animated: true }).metadata()
  expect([metadata.width, metadata.height, metadata.pages || 1]).toEqual([256, 256, 1])
})

it.each(['../secret', '/outside', 'image.png?url=outside', 'image.png#fragment'])('rejects invalid bucket key %s', async (key) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const res = response()
  await mobileImage({ params: {}, query: { key } } as any, res)
  expect(res.status).toBe(400)
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects non-image content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not an image')))
  const res = response()
  await mobileImage({ params: {}, query: { key: 'model.vox' } } as any, res)
  expect(res.status).toBe(422)
})

it('passes resized pixels to the ASTC encoder, cleans up and caches the result', async () => {
  let input = ''
  vi.mocked(pack).mockImplementation(async (options: any) => {
    input = options.input
    const metadata = await sharp(input).metadata()
    expect([metadata.width, metadata.height]).toEqual([256, 128])
    expect(options).toMatchObject({ compression: 'ASTC_8x8', quality: 'astcfast', mipmap: true, pot: 'no', square: 'no' })
    await writeFile(options.output, 'encoded ktx')
  })
  const bytes = await sharp({ create: { width: 1024, height: 512, channels: 4, background: '#ff000080' } })
    .png()
    .toBuffer()
  const fetch = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetch)
  const req = { params: {}, query: { key: 'astc-test.png', hint: '.astc.ktx' } } as any
  const res = response()
  await mobileImage(req, res)
  expect(res.status).toBe(302)
  expect(upload.ContentType).toBe('image/ktx')
  expect(upload.Bucket).toBe('voxels-ugc')
  expect(upload.Key).toBe('astc-test.png.mobile-v1.astc.ktx')
  expect(upload.Body.toString()).toBe('encoded ktx')
  await expect(access(input)).rejects.toThrow()
  const cached = response()
  await mobileImage(req, cached)
  expect(cached.location).toEqual(res.location)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('redirects an existing bucket sidecar without downloading or encoding', async () => {
  send.mockResolvedValue({})
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const res = response()
  await mobileImage({ params: { 0: 'parcel/existing.png' }, query: {} } as any, res)
  expect(res.location).toBe('https://ugc.voxels.com/parcel/existing.png.mobile-v1.webp')
  expect(res.status).toBe(302)
  expect(fetch).not.toHaveBeenCalled()
  expect(upload).toBeUndefined()
})
