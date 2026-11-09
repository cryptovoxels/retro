import { expect, test, vi } from 'vitest'
import sharp from 'sharp'

const { gifSheet, main } = require('../../compressor/function/packages/textures/compress')
const { S3Client } = require('@aws-sdk/client-s3')

test('cached GIF redirects retain timing and use the versioned 512px sheet', async () => {
  const frames = JSON.stringify({ frames: 16, duration: 2400, columns: 4, rows: 4 })
  const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({ Metadata: { frames } })
  try {
    const result = await main({ key: 'parcel/1/animation.gif', width: 256, height: 256 })
    expect(result.statusCode).toBe(302)
    const url = new URL(result.headers.Location)
    expect(decodeURIComponent(url.pathname)).toBe('/parcel/1/animation.gif/width=512,height=512,fit=cover,format=astc,sheet=4x4-v1.ktx')
    expect(url.searchParams.get('frames')).toBe(frames)
    expect(send).toHaveBeenCalledTimes(1)
  } finally {
    send.mockRestore()
  }
})

test('GIF sheets sample the full timeline into 16 tiles and retain transparency', async () => {
  const pixels = Buffer.alloc(8 * 8 * 4 * 20)
  const delays = Array.from({ length: 20 }, (_, i) => (i === 0 ? 500 : 100))
  for (let frame = 0; frame < 20; frame++) {
    for (let pixel = 1; pixel < 64; pixel++) {
      const offset = (frame * 64 + pixel) * 4
      pixels[offset] = frame * 10
      pixels[offset + 3] = 255
    }
  }
  const gif = await sharp(pixels, { raw: { width: 8, height: 160, channels: 4, pageHeight: 8 } })
    .gif({ delay: delays, dither: 0, keepDuplicateFrames: true })
    .toBuffer()
  const { sheet, frames } = await gifSheet(gif, 'fill')
  expect(JSON.parse(frames)).toEqual({ frames: 16, duration: 2400, columns: 4, rows: 4 })
  const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true })
  expect([info.width, info.height, info.channels]).toEqual([512, 512, 4])
  for (let tile = 0; tile < 16; tile++) {
    const time = tile * 150
    const frame = time < 500 ? 0 : 1 + Math.floor((time - 500) / 100)
    const left = (tile % 4) * 128
    const top = Math.floor(tile / 4) * 128
    const center = ((top + 64) * 512 + left + 64) * 4
    expect(data[center]).toBe(frame * 10)
    expect(data[(top * 512 + left) * 4 + 3]).toBe(0)
  }
})

test('single-frame GIFs fill every tile with a usable duration', async () => {
  const gif = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#00ff00' } })
    .gif()
    .toBuffer()
  const { sheet, frames } = await gifSheet(gif, 'cover')
  expect(JSON.parse(frames).duration).toBeGreaterThan(0)
  const { channels } = await sharp(sheet).stats()
  expect(channels[1].min).toBe(255)
  expect(channels[3].min).toBe(255)
})
