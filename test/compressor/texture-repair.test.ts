import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { textureHash, textureHashOptions } from '../../common/helpers/texture-hash'

let directory: string
vi.mock('../../compressor/src/config', () => ({ default: { cacheDir: (name: string) => join(directory, name) } }))
vi.mock('../../compressor/src/storage', () => ({ hashify: (url: string, opts: any) => textureHash(url, opts) }))
import { Texture } from '../../compressor/src/texture'

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'texture-test-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it.each([false, true])('matches existing SHA-1 cache names (transparent=%s)', (transparent) => {
  const opts = textureHashOptions(transparent, true, false, 256)
  const old: any = { ...opts }
  delete old.passthrough
  delete old.dontFlipY
  const url = 'https://example.com/cat.png'
  expect(textureHash(url, opts)).toBe(
    createHash('sha1')
      .update(url + JSON.stringify(old))
      .digest('hex'),
  )
  expect(textureHash(url, opts)).toHaveLength(40)
})

it.each(['gif', 'webp'] as const)('returns the first %s frame as one static PNG', async (format) => {
  const rgba = Buffer.alloc(16 * 32 * 4)
  for (let pixel = 0; pixel < 16 * 32; pixel++) {
    rgba[pixel * 4 + (pixel < 16 * 16 ? 0 : 2)] = 255
    rgba[pixel * 4 + 3] = 255
  }
  const input = await sharp(rgba, { raw: { width: 16, height: 32, pageHeight: 16, channels: 4 } })
    [format]({ delay: [100, 100], loop: 0 })
    .toBuffer()
  expect((await sharp(input, { animated: true }).metadata()).pages).toBe(2)
  const texture = new Texture(`https://example.com/animated.${format}`, textureHashOptions(true, true, true, 16))
  await writeFile(join(directory, texture.id), input)
  await texture.createMedium()
  const output = sharp(join(directory, texture.resizedName))
  const metadata = await output.metadata()
  expect([metadata.format, metadata.width, metadata.height, metadata.pages || 1]).toEqual(['png', 16, 16, 1])
  expect(texture.frameInfo).toEqual({ frames: 1, duration: 0 })
  const { data } = await output.raw().toBuffer({ resolveWithObject: true })
  expect(data[0]).toBeGreaterThan(240)
  expect(data[2]).toBeLessThan(15)
})

it('converts AVIF/HEIF input to a compressible PNG', async () => {
  const input = await sharp({ create: { width: 24, height: 16, channels: 3, background: 'red' } })
    .avif()
    .toBuffer()
  const texture = new Texture('https://example.com/image.avif', textureHashOptions(false, true, false, 16))
  await writeFile(join(directory, texture.id), input)
  await texture.createMedium()
  expect(texture.outputFormat).toBe('png')
  expect((await sharp(join(directory, texture.resizedName)).metadata()).format).toBe('png')
})
