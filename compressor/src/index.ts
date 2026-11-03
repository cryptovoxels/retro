// ABOUTME: Texture compressor service - compresses images to GPU texture formats.
// ABOUTME: Single endpoint /compressed that downloads, compresses, and uploads to S3.

import { Request, Response } from 'express'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { URL } from 'url'
import path from 'path'
import config from './config'
import { clear, DownloadError, FindResult, s3Move, s3Copy } from './storage'
import * as storage from './storage'
import * as texture from './texture'
import * as compressor from './compress'
import { CreateError, Texture } from './texture'
import { app } from './www'
import sharp from 'sharp'
import { mobileImage } from './mobile'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const s3 = config.space.client()

;(async () => {
  try {
    const command = new ListObjectsV2Command({ Bucket: config.space.name, MaxKeys: 1 })
    await s3.send(command)
    console.log(`Connected to bucket '${config.space.name}'`)
  } catch (err) {
    console.error(`Can't connect to bucket '${config.space.name}': ${err}`)
  }
})()

// Clean scratch space every hour (files older than 1 hour)
const ONE_HOUR_IN_SECONDS = 3600
setInterval(() => clear(ONE_HOUR_IN_SECONDS), ONE_HOUR_IN_SECONDS * 1000)

app.get('/', (req, res) => {
  res.status(200).end('texture compressor')
})

app.route('/compressed').all(compressed)
app.get('/mobile', mobileImage)

app.get('/health', (req, res) => {
  res.status(200).end('up')
})

app.get('/*', mobileImage)

function compressed(request: Request, response: Response) {
  request.setTimeout(1000 * 30)

  const sourceURL = request.query.url as string
  if (!isValidURL(sourceURL)) {
    response.writeHead(400, 'url is not valid URL')
    return response.end(`?url '${sourceURL}' is not valid URL`)
  }

  const { forceUpdate, hint, textureOptions, version } = parseRequest(request, sourceURL)

  findCachedTexture(forceUpdate, sourceURL, textureOptions, hint)
    .then((result) => result)
    .catch(() => downloadAndCompress(sourceURL, textureOptions, hint))
    .then((result) => textureResponse(result, response, version))
    .catch((error) => errorResponse(error, response))
}

function downloadAndCompress(sourceURL: string, textureOptions: texture.Options, hint: string): Promise<FindResult> {
  const tex = new texture.Texture(sourceURL, textureOptions)
  const fallbackURL = storage.getSourceURL(tex.id)

  return storage
    .download(tex, fallbackURL)
    .then((tex) => saveSourceToS3(tex))
    .then((tex) => tex.createMedium())
    .then((tex) => compressTexture(hint, tex))
    .then((result) => moveToS3(result))
}

const SOURCE_MAX_SIZE = 4096
const SOURCE_SUFFIX = '_source.png'

function saveSourceToS3(txt: Texture): Promise<Texture> {
  const sourcePath = config.cacheDir(txt.id)
  const sourceKey = txt.id + SOURCE_SUFFIX
  const destPath = config.cacheDir(sourceKey)

  return sharp(sourcePath)
    .resize(SOURCE_MAX_SIZE, SOURCE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(destPath)
    .then(() => s3Copy(sourceKey, config.s3Prefix(), '{}'))
    .then(() => txt)
}

function parseRequest(req: Request, sourceURL: string) {
  const forceUpdate = req.query.force_update === '1' && req.method !== 'HEAD'
  const size = parseInt(req.query.size as string, 10) || 0
  const mode = (req.query.mode as string) || 'color'
  const stretch = (req.query.stretch as string) === 'true'
  const gif = (req.query.gif as string) || 'sheet'
  const passthrough = (req.query.passthrough as string) === 'true'
  const dontFlipY = (req.query.flip_y as string) === 'false'
  const hint = (req.query.hint as string) || path.extname(sourceURL)
  const textureOptions = { size, mode, stretch, gif, passthrough, dontFlipY }
  const version = (req.query.version as string) || null
  return { forceUpdate, hint, textureOptions, version }
}

function isValidURL(urlString: string): boolean {
  try {
    const parsed = new URL(urlString)
    return ['http:', 'https:', 'ftp:', 'ftps:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function findCachedTexture(forceUpdate: boolean, sourceURL: string, textureOptions: texture.Options, hint: string): Promise<FindResult> {
  if (forceUpdate) {
    storage.deleteAll(sourceURL, textureOptions)
    return Promise.reject(new Error('force update requested'))
  }
  return storage.find(sourceURL, textureOptions, hint)
}

function compressTexture(hint: string, tex: Texture): Promise<FindResult> {
  return compressor.compress(hint, tex.resizedName as string, tex.hasAlpha()).then((location) => {
    return { location, texture: tex }
  })
}

function moveToS3(result: FindResult): Promise<FindResult> {
  return s3Move(result.location, config.s3Prefix(), result.texture.JSONHeaders()).then((s3Location) => {
    return { location: s3Location, texture: result.texture }
  })
}

function textureResponse(found: FindResult, res: Response, version: string | null) {
  if (isValidURL(found.location)) {
    res.set({ 'Cache-Control': 'public,max-age=31536000,immutable' })
    const redirectionURL = version ? found.location + `?version=${version}` : found.location
    res.location(redirectionURL)
    const body = redirectionURL + '\n'
    res.set('Content-Length', `${body.length}`)
    return res.status(301).end(body)
  }

  const headers = found.texture.HTTPHeaders('x-')
  return res.sendFile(found.location, { root: config.cacheDir(), headers })
}

function errorResponse(error: any, response: Response) {
  response.contentType('text/plain')
  if (error instanceof DownloadError) {
    console.error(`Download failed: ${error.url} - ${error.message}`)
    const msg = `failed to download image for texture compression: ${error.message}`
    return response.status(400).header('x-error', sanitizeHeaderValue(msg)).end(msg)
  }
  if (error instanceof CreateError) {
    console.error(`Compression failed: ${error.file} - ${error.message}`)
    const msg = `failed to compress the image into texture: ${error.message}`
    return response.status(500).header('x-error', sanitizeHeaderValue(msg)).end(msg)
  }
  console.error(`Compression failed: ${error.toString()}`)
  const msg = `failed to compress the image into a texture: ${error.toString()}`
  return response.status(500).header('x-error', sanitizeHeaderValue(msg)).end(msg)
}

// HTTP header values can only contain a limited set of characters
// https://developers.cloudflare.com/rules/transform/request-header-modification/reference/header-format/
// https://stackoverflow.com/questions/686217/maximum-on-http-header-values
export function sanitizeHeaderValue(value: string) {
  return value.replace(/[^\w_ :;.,\/"'?!(){}\[\]@<>=\-+*#$&`|~^%]/g, ' ').slice(0, 200)
}
