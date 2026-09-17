// ABOUTME: Last-chance fetch from the old herring caches when the origin is dead.
// ABOUTME: Key formulas from herring pkg/utils/filename_generators.go, verified against a full bucket dump.

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { sniffBytes, type SniffKind } from '../../common/helpers/magic'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const slug = (url: string) => (url.slice(0, 64) + '-').replace(/[^A-Za-z0-9]/g, '-')

// slug(url[0:64]) + md5(url + opts); opts is the literal 'undefined' (images/audio) or 'null' (vox), js legacy
export const herringName = (url: string, opts: 'undefined' | 'null') => slug(url) + md5(url + opts)

export function hoardKeys(url: string): Array<{ bucket: string; key: string }> {
  const img = herringName(url, 'undefined')
  const vox = herringName(url, 'null')
  const out = [
    { bucket: 'crvox-object-backup', key: `image_proxy_volume/cache/imgproxy/source/${img}` },
    { bucket: 'crvox-object-backup', key: `image_proxy_volume_2/cache/imgproxy/source/${img}` },
    // vox in the imgproxy source cache kept their extension, images did not
    { bucket: 'crvox-object-backup', key: `image_proxy_volume/cache/imgproxy/source/${vox}.vox` },
    { bucket: 'crvox-object-backup', key: `image_proxy_volume_2/cache/imgproxy/source/${vox}.vox` },
    { bucket: 'crvoxproxy', key: `vox/source/${vox}.vox` },
    { bucket: 'crvoxproxy', key: `audio/source/${img}` },
    { bucket: 'crvox-object-backup', key: `asset_urls/${slug(url)}${Buffer.from(url + 'null').toString('hex')}${md5('')}` },
  ]
  const atlas = url.match(/\/atlas\/([a-f0-9]{40})/)?.[1]
  if (atlas) out.unshift({ bucket: 'crvox-object-backup', key: `image_proxy_volume_2/atlas/atlas/${atlas}.png` })
  return out
}

const REGION: Record<string, string> = { 'crvox-object-backup': 'sfo3', crvoxproxy: 'sfo2' }
const clients: Record<string, S3Client> = {}

function client(bucket: string) {
  const region = REGION[bucket]
  if (!clients[region]) {
    clients[region] = new S3Client({
      region,
      endpoint: `https://${region}.digitaloceanspaces.com`,
      credentials: { accessKeyId: process.env.FULLBUCKET_ACCESS || '', secretAccessKey: process.env.FULLBUCKET_SECRET || '' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  }
  return clients[region]
}

export function hoardEnabled() {
  return !!(process.env.FULLBUCKET_ACCESS && process.env.FULLBUCKET_SECRET)
}

export async function hoardFetch(url: string, kind: SniffKind): Promise<{ bytes: Uint8Array; contentType: string; key: string } | null> {
  if (!hoardEnabled()) return null
  for (const { bucket, key } of hoardKeys(url)) {
    try {
      const res = await client(bucket).send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const bytes = await res.Body?.transformToByteArray()
      // herring cached error pages too, keep digging past those
      if (bytes?.length && sniffBytes(bytes, res.ContentType || '', kind).ok) return { bytes, contentType: res.ContentType || '', key: `${bucket}/${key}` }
    } catch {
      // not there, next
    }
  }
  return kind === 'image' ? ktxDig(url) : null
}

// last resort: the old compressor's dxt ktx is the only copy. decode it back to a png.
// compressor/src/storage.ts hashify: sha1(url + json(opts)). gifs were sprite sheets, useless as a still.
const TEXTURES_CDN = 'https://textures.sfo2.cdn.digitaloceanspaces.com/compressed/'

async function ktxDig(url: string) {
  if (/\.gif/i.test(url)) return null
  let normal = url
  try {
    normal = new URL(url).toString()
  } catch {}
  for (const stretch of [false, true])
    for (const mode of ['color', 'transparent'])
      for (const u of new Set([url, normal])) {
        const hash = createHash('sha1')
          .update(u + JSON.stringify({ size: 0, mode, stretch, gif: 'sheet' }))
          .digest('hex')
        const key = `${hash}_medium.dxt.ktx`
        try {
          const res = await fetch(TEXTURES_CDN + key, { signal: AbortSignal.timeout(15000) })
          if (!res.ok) continue
          const png = await ktxToPng(new Uint8Array(await res.arrayBuffer()))
          if (png) return { bytes: png, contentType: 'image/png', key: `textures/${key} (decoded)` }
        } catch {}
      }
  return null
}

// ktx1 header, level 0 only; DXT1 (0x83F0/0x83F1) or DXT5 (0x83F3). compressor flipped Y before encoding, flip back.
async function ktxToPng(ktx: Uint8Array): Promise<Uint8Array | null> {
  const dv = new DataView(ktx.buffer, ktx.byteOffset, ktx.byteLength)
  if (ktx.length < 68 || dv.getUint32(12, true) !== 0x04030201) return null
  const format = dv.getUint32(28, true)
  const width = dv.getUint32(36, true)
  const height = dv.getUint32(40, true)
  const kv = dv.getUint32(60, true)
  const dxt5 = format === 0x83f3
  if (!dxt5 && format !== 0x83f0 && format !== 0x83f1) return null
  const data = ktx.subarray(64 + kv + 4, 64 + kv + 4 + dv.getUint32(64 + kv, true))

  const bw = Math.ceil(width / 4)
  const rgba = new Uint8Array(width * height * 4)
  const blockSize = dxt5 ? 16 : 8
  const c = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)]
  const alpha = new Uint8Array(16)
  for (let b = 0; b * blockSize + blockSize <= data.length; b++) {
    const o = b * blockSize + (dxt5 ? 8 : 0)
    const c0 = data[o] | (data[o + 1] << 8)
    const c1 = data[o + 2] | (data[o + 3] << 8)
    rgb565(c0, c[0])
    rgb565(c1, c[1])
    if (dxt5 || c0 > c1) {
      for (let i = 0; i < 3; i++) {
        c[2][i] = (2 * c[0][i] + c[1][i]) / 3
        c[3][i] = (c[0][i] + 2 * c[1][i]) / 3
      }
      c[3][3] = 255
    } else {
      for (let i = 0; i < 3; i++) c[2][i] = (c[0][i] + c[1][i]) / 2
      c[3].fill(0)
    }
    if (dxt5) {
      const a0 = data[b * blockSize]
      const a1 = data[b * blockSize + 1]
      let bits = 0
      for (let i = 0; i < 6; i++) bits += data[b * blockSize + 2 + i] * 2 ** (8 * i)
      for (let i = 0; i < 16; i++) {
        const k = Math.floor(bits / 2 ** (3 * i)) % 8
        alpha[i] = k === 0 ? a0 : k === 1 ? a1 : a0 > a1 ? ((8 - k) * a0 + (k - 1) * a1) / 7 : k === 6 ? 0 : k === 7 ? 255 : ((6 - k) * a0 + (k - 1) * a1) / 5
      }
    }
    const bx = (b % bw) * 4
    const by = Math.floor(b / bw) * 4
    for (let i = 0; i < 16; i++) {
      const x = bx + (i % 4)
      const y = by + Math.floor(i / 4)
      if (x >= width || y >= height) continue
      const idx = (data[o + 4 + Math.floor(i / 4)] >> ((i % 4) * 2)) & 3
      const p = ((height - 1 - y) * width + x) * 4
      rgba[p] = c[idx][0]
      rgba[p + 1] = c[idx][1]
      rgba[p + 2] = c[idx][2]
      rgba[p + 3] = dxt5 ? alpha[i] : c[idx][3]
    }
  }
  return new Uint8Array(
    await sharp(Buffer.from(rgba.buffer), { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  )
}

function rgb565(v: number, out: Uint8Array) {
  out[0] = ((v >> 11) & 31) * 8.226
  out[1] = ((v >> 5) & 63) * 4.048
  out[2] = (v & 31) * 8.226
  out[3] = 255
}
