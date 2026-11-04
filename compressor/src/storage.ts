// ABOUTME: S3/Spaces storage operations for compressed textures.
// ABOUTME: Handles upload, lookup, caching, and deletion of texture files.

import { DeleteObjectsCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { textureHash } from '../../common/helpers/texture-hash'
import { URL } from 'url'
import fs from 'fs'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { jobSignal, queueJob } from './utils'
import path from 'path'
import config from './config'
import { Options, Texture, Type } from './texture'
import sharp from 'sharp'
import * as compressor from './compress'
import ErrnoException = NodeJS.ErrnoException
import QuickLRU from 'quick-lru'

export interface FindResult {
  location: string
  texture: Texture
}

// In-memory cache to avoid S3 HEAD requests. Each entry ~160 bytes, 100k entries ~16MB.
const s3LookupCache = new QuickLRU<string, string>({ maxSize: 100000 })

// Constructs the S3 URL for a stored source file (used as fallback when original URL fails)
export function getSourceURL(id: string): string {
  return `${config.space.cdn_host}/${config.s3Prefix()}/${id}_source.png`
}

export function hashify(value: string, opts: Options): string {
  return textureHash(value, opts as any)
}

export function deleteAll(source: string, opts: Options) {
  const remote: string[] = []
  const orig = hashify(source, opts)
  remote.push(orig)
  unlink(config.cacheDir(orig))
  compressor.Compressions.forEach((v, suffix) => {
    const medium = hashify(source, opts) + '_' + Type.medium + suffix
    unlink(config.cacheDir(medium))
    remote.push(medium)
  })
  s3Delete(...remote)
}

// Searches both S3 and local disk for cached texture. Rejects if not found.
export function find(sourceURL: string, opts: Options, suffix: string): Promise<FindResult> {
  const s3Result = s3Find(sourceURL, opts, Type.medium, suffix)
  const localResult = localFind(sourceURL, opts, Type.medium, suffix)
  return Promise.all([s3Result, localResult]).then((results) => {
    const found = results.filter((r) => r.location !== '')
    if (found.length === 0) {
      return Promise.reject('not found')
    }
    return found[0]
  })
}

// Converts Dropbox share URLs to direct download URLs
export function normalizeDropboxURL(url: string): string {
  if (url.match(/^https...www.dropbox.com/)) {
    return url.replace(/^https...www.dropbox.com/, 'https://dl.dropboxusercontent.com')
  }
  return url
}

export class DownloadError extends Error {
  public url: string
  public statusCode: number
  public statusMessage: string
  constructor(url: string, statusCode?: number, statusMessage?: string) {
    super(`remote server responded with ${statusCode}: ${statusMessage}`)
    this.url = url
    this.statusCode = statusCode || 503
    this.statusMessage = statusMessage || 'Generic failure'
  }
}

export function download(texture: Texture, fallbackURL?: string): Promise<Texture> {
  const sourceURL = new URL(normalizeDropboxURL(texture.source))
  const destPath = config.cacheDir(texture.id)
  return queueJob(() => downloader(sourceURL, destPath), 'fetch')
    .then(() => texture)
    .catch((error: any) => {
      if (!fallbackURL) {
        throw error
      }
      const fallbackSource = new URL(fallbackURL)
      return queueJob(() => downloader(fallbackSource, destPath), 'fetch').then(() => {
        console.log('fallback URL used ' + fallbackURL)
        return texture
      })
    })
}

async function downloader(sourceURL: URL, destPath: string): Promise<void> {
  const signal = jobSignal()
  try {
    const response = await fetch(sourceURL, { signal, headers: { 'User-Agent': 'CryptovoxelsTextureCompressor/1.0' } })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new DownloadError(sourceURL.toString(), response.status, response.statusText)
    }
    let size = 0
    const limit = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length
        done(size > 16 * 1024 * 1024 ? new Error('source exceeds 16 MiB') : null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as any), limit, fs.createWriteStream(destPath), { signal })
  } catch (error) {
    await fs.promises.rm(destPath, { force: true })
    throw error
  }
}

export function s3Move(source: string, prefix: string, extraHeaders: string): Promise<string> {
  return s3Copy(source, prefix, extraHeaders).then((location) => {
    unlink(config.cacheDir(source))
    return location
  })
}

export async function s3Copy(source: string, prefix: string, extraHeaders: string): Promise<string> {
  if (!source) {
    throw new Error(`path '${source}' is not valid`)
  }
  const { metadata, contentType, maxAge } = parseS3UploadSettings(extraHeaders)

  const fileContent = await fs.promises.readFile(config.cacheDir(source))
  const command = new PutObjectCommand({
    Bucket: config.space.name,
    Key: prefix + '/' + path.basename(source),
    Body: fileContent,
    ContentType: contentType,
    ACL: 'public-read',
    Metadata: metadata,
    CacheControl: `public,max-age=${maxAge},s-maxage=${maxAge},immutable`,
  })

  const s3 = config.space.client()
  await queueJob(() => s3.send(command, { abortSignal: jobSignal() }), 'upload')
  return `${config.space.cdn_host}/${prefix}/${path.basename(source)}`
}

export function clear(maxAgeInSeconds: number) {
  console.log('cleaning old local temp files')
  fs.readdir(config.cacheDir(), (error, files) => {
    if (error) {
      return console.error(error)
    }
    files.forEach((file) => {
      fs.stat(config.cacheDir(file), (statError, stat) => {
        if (statError) {
          return console.error(statError)
        }
        const fileAgeMs = Date.now() - new Date(stat.ctime).getTime()
        const maxAgeMs = maxAgeInSeconds * 1000
        if (fileAgeMs < maxAgeMs) {
          return
        }
        fs.rm(config.cacheDir(file), { recursive: true, force: true }, (rmError) => {
          if (rmError) {
            return console.error(rmError)
          }
          console.log('deleted old file', file)
        })
      })
    })
  })
}

function localFind(sourceURL: string, opts: Options, type: Type, suffix: string): Promise<FindResult> {
  const filename = `${hashify(sourceURL, opts)}_${type}${suffix}`
  return new Promise((resolve) => {
    const texture = new Texture(sourceURL, opts)
    try {
      const stat = fs.statSync(config.cacheDir(filename))
      if (stat.isFile()) {
        return sharp(config.cacheDir(texture.id))
          .timeout({ seconds: 10 })
          .metadata()
          .then((metadata) => {
            texture.setMetadata(metadata, type)
            return resolve({ location: filename, texture })
          })
          .catch((error) => {
            console.error('localFind Metadata:', error)
            resolve({ location: filename, texture })
          })
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('localFind statSync:', error)
      }
    }
    return resolve({ location: '', texture })
  })
}

export function unlink(file: string): boolean {
  let res: fs.Stats
  try {
    res = fs.statSync(file)
  } catch {
    return false
  }
  if (!res.isFile()) {
    return false
  }
  fs.unlinkSync(file)
  return true
}

async function s3Find(sourceURL: string, opts: Options, size: Type, suffix: string): Promise<FindResult> {
  const s3 = config.space.client()
  const filename = hashify(sourceURL, opts) + '_' + size + suffix
  const key = path.join(config.s3Prefix(), filename)
  const url = config.space.cdn_host + '/' + key

  const texture = new Texture(sourceURL, opts)

  const cachedURL = s3LookupCache.get(key)
  if (cachedURL) {
    return { location: cachedURL, texture }
  }

  const command = new HeadObjectCommand({
    Bucket: config.space.name,
    Key: key,
  })

  try {
    await queueJob(() => s3.send(command, { abortSignal: jobSignal() }), 'fetch')
    s3LookupCache.set(key, url)
    return { location: url, texture }
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return { location: '', texture }
    }
    throw error
  }
}

export async function s3Delete(...objects: string[]) {
  const toDelete = objects.map((obj) => {
    const key = path.join(config.s3Prefix(), path.basename(obj))
    s3LookupCache.delete(key)
    return { Key: key }
  })

  const command = new DeleteObjectsCommand({
    Bucket: config.space.name,
    Delete: { Objects: toDelete },
  })

  await config.space.client().send(command, { abortSignal: jobSignal() })
}

function parseS3UploadSettings(headersJSON: string) {
  let metadata: Record<string, string> = {}
  try {
    metadata = JSON.parse(headersJSON)
  } catch {
    // headersJSON may be '{}' or malformed - use defaults below
  }

  let contentType = 'image/ktx'
  if ('content-type' in metadata) {
    contentType = metadata['content-type']
    delete metadata['content-type']
  }

  let maxAge = '31536000'
  if ('max-age' in metadata) {
    maxAge = metadata['max-age']
    delete metadata['max-age']
  }
  return { metadata, contentType, maxAge }
}
