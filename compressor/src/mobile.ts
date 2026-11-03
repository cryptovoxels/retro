import type { Request, Response } from 'express'
import sharp from 'sharp'
import { pack, runJob, queueJob, jobSignal } from './utils'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { ugcClient, UGC_BUCKET } from '../../server/lib/ugc'

const cache = new Set<string>()

export async function mobileImage(req: Request, res: Response) {
  try {
    return await runJob(() => queueJob(() => convertImage(req, res)))
  } catch {
    return res.sendStatus(422)
  }
}

async function convertImage(req: Request, res: Response) {
  const key = String(req.params[0] || req.query.key || '')
  const astc = req.query.hint === '.astc.ktx'
  if (!key || key.startsWith('/') || key.includes('..') || /[?#\\]/.test(key)) return res.sendStatus(400)
  if (req.query.hint && !astc) return res.sendStatus(400)
  if (/\.mobile-v1\.(astc\.ktx|webp)$/.test(key)) return res.sendStatus(400)
  const cacheKey = `${key}.mobile-v1.${astc ? 'astc.ktx' : 'webp'}`
  const redirect = () => res.set('Cache-Control', 'public, max-age=31536000, immutable').redirect(302, `https://ugc.voxels.com/${cacheKey.split('/').map(encodeURIComponent).join('/')}`)
  if (cache.has(cacheKey)) return redirect()
  let directory: string | undefined
  try {
    const s3 = ugcClient()
    try {
      await s3.send(new HeadObjectCommand({ Bucket: UGC_BUCKET, Key: cacheKey }), { abortSignal: jobSignal() })
      return redirect()
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NotFound') throw error
    }
    const source = await fetch(`https://ugc.voxels.com/${key.split('/').map(encodeURIComponent).join('/')}`, {
      redirect: 'error',
      signal: jobSignal(),
    })
    if (!source.ok || !source.body) return res.sendStatus(404)
    const reader = source.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024 * 1024) {
        await reader.cancel()
        return res.sendStatus(413)
      }
      chunks.push(value)
    }
    const resized = sharp(Buffer.concat(chunks), { limitInputPixels: 16 * 1024 * 1024, pages: 1 })
      .timeout({ seconds: 1 })
      .rotate()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    let image: Buffer
    if (astc) {
      directory = await mkdtemp(join(tmpdir(), 'mobile-texture-'))
      const input = join(directory, 'source.png')
      const output = join(directory, 'texture.astc.ktx')
      // KTX uploads ignore Babylon's flipY flag.
      await resized.flip().png().toFile(input)
      await pack({ input, output, type: 'astc', compression: 'ASTC_8x8', quality: 'astcfast', mipmap: true, flipY: false, pot: 'no', square: 'no', verbose: false })
      image = await readFile(output)
    } else {
      image = await resized.webp({ quality: 55, effort: 0 }).toBuffer()
    }
    await s3.send(new PutObjectCommand({ Bucket: UGC_BUCKET, Key: cacheKey, Body: image, ContentType: astc ? 'image/ktx' : 'image/webp', ACL: 'public-read', CacheControl: 'public, max-age=31536000, immutable' }), {
      abortSignal: jobSignal(),
    })
    if (cache.size >= 10000) cache.delete(cache.values().next().value!)
    cache.add(cacheKey)
    return redirect()
  } catch (error) {
    console.error('Mobile texture failed', key, error)
    return res.sendStatus(422)
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
