import { isMobile } from '../../common/helpers/detector'
// ABOUTME: Texture loading with compressed texture support and CDN caching.
// ABOUTME: Handles fetching from bucket (cached) with fallback to compressor service.

/**
 * TEXTURE LOADING FLOW:
 *
 * 1. Feature calls fetchTexture(url, options)
 * 2. We compute two URLs:
 *    - cachedUrl: Direct CDN bucket link (fast, but might 404 if not cached yet)
 *    - compressorUrl: Compressor service (slower, but always works and caches result)
 * 3. Try cachedUrl first, fall back to compressorUrl on failure
 * 4. The compressor uploads to CDN bucket, so next request hits the cache
 *
 * Environment variables:
 *   TEXTURE_HOST   - Compressor service URL
 *   TEXTURE_BUCKET - CDN bucket URL (default: texture.voxels.com)
 */

import config from '../../common/config'
import { isUgcTextureUrl } from '../../common/helpers/parcel-compile'
import { getGpuTextureFormat } from './gpu'
import { buildCachedTextureUrl } from './bucket'
import { Metadata, metadataFromResponse } from './metadata-cache'
import { registerAnimation } from './animation'

type TextureData = {
  buffer: ArrayBuffer
  metadata: Metadata
}

export interface TextureOptions {
  transparent?: boolean
  stretch?: boolean
  pixelated?: boolean
  flipY?: boolean
  mipmaps?: boolean
  retry?: boolean
}

type TextureUrls = {
  cachedUrl: string
  compressorUrl: string
}

const functionTrial = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('textureFunction') === '1'
const functionUrl = 'https://faas-sfo3-7872a1dd.doserverless.co/api/v1/web/fn-7f487c48-1176-4b03-82aa-03c5faebe781/textures/compress'

// Prevent multiple parallel requests for the same URL
const currentFetches = new Map<string, Promise<TextureData>>()

const mobileBytes = new WeakMap<BABYLON.Scene, number>()
const TEXTURE_BYTES = Math.ceil((256 * 256 * 4 * 4) / 3)
const MOBILE_BYTES = 64 * 1024 * 1024

export async function fetchTexture(scene: BABYLON.Scene, srcURL: string | null, signal: AbortSignal, options: TextureOptions = {}): Promise<BABYLON.Texture> {
  while (true) {
    signal.throwIfAborted()
    try {
      const attempt = options.retry ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : signal
      const texture = await textureAttempt(scene, srcURL, attempt, options)
      if (signal.aborted) {
        texture.dispose()
        signal.throwIfAborted()
      }
      return texture
    } catch (error) {
      if (!options.retry || signal.aborted) throw error
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(signal.reason)
        }
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort)
            resolve()
          },
          Math.max(30000, (error as any)?.retryAfter || 0) + Math.random() * 3000,
        )
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
}

async function textureAttempt(scene: BABYLON.Scene, srcURL: string | null, signal: AbortSignal, options: TextureOptions): Promise<BABYLON.Texture> {
  if (!isMobile()) return loadTexture(scene, srcURL, signal, options)
  const used = mobileBytes.get(scene) || 0
  if (used + TEXTURE_BYTES > MOBILE_BYTES) {
    if (options.retry) throw new Error('Mobile texture budget full')
    return fetchNoImageTexture(scene)
  }
  mobileBytes.set(scene, used + TEXTURE_BYTES)
  const release = () => mobileBytes.set(scene, Math.max(0, (mobileBytes.get(scene) || 0) - TEXTURE_BYTES))
  try {
    const texture = await loadTexture(scene, srcURL, signal, options)
    texture.onDisposeObservable.addOnce(release)
    return texture
  } catch (err) {
    release()
    throw err
  }
}

async function loadTexture(scene: BABYLON.Scene, srcURL: string | null, signal: AbortSignal, options: TextureOptions): Promise<BABYLON.Texture> {
  const { transparent = false, stretch = true, pixelated = false, flipY = true, mipmaps = true } = options

  if (srcURL?.startsWith('ugc://')) srcURL = 'https://ugc.voxels.com/' + srcURL.slice(6)

  if (functionTrial && srcURL && isUgcTextureUrl(srcURL) && getGpuTextureFormat() === '.astc.ktx' && !/\.gif(?:$|[?#])/i.test(srcURL)) {
    const size = isMobile() ? 256 : 512
    const key = new URL(srcURL).pathname.slice(1)
    const fit = stretch ? 'fill' : 'cover'
    const url = `${functionUrl}?key=${encodeURIComponent(key)}&width=${size}&height=${size}&fit=${fit}&format=astc&hint=.astc.ktx`
    const cached = `https://texture.voxels.com/${key}/width=${size},height=${size},fit=${fit},format=astc.ktx?hint=.astc.ktx`
    try {
      const attempt = AbortSignal.any([signal, AbortSignal.timeout(10000)])
      const texture = await fetchAndCreateTexture(scene, cached, url, attempt, { flipY, mipmaps })
      if (pixelated) texture.updateSamplingMode(1)
      return texture
    } catch {
      signal.throwIfAborted()
      // Keep the existing compressor available during the Function trial.
    }
  }

  // Desktop UGC must use the compressed cache too; originals stall texture uploads.
  if (isMobile() && srcURL && isUgcTextureUrl(srcURL)) {
    try {
      const hint = getGpuTextureFormat() === '.astc.ktx' ? '?hint=.astc.ktx' : ''
      const url = `https://compressed.voxels.com${new URL(srcURL).pathname}${hint}`
      const texture = await fetchAndCreateTexture(scene, url, undefined, signal, { flipY, mipmaps })
      if (pixelated) texture.updateSamplingMode(1)
      return texture
    } catch (error) {
      if (options.retry) throw error
      return await fetchNoImageTexture(scene)
    }
  }

  const urls = getTextureUrls(srcURL, transparent, stretch)
  if (!urls) {
    if (options.retry) throw new Error('No image URL')
    return await fetchNoImageTexture(scene)
  }

  try {
    const texture = await fetchAndCreateTexture(scene, urls.cachedUrl, isMobile() ? undefined : urls.compressorUrl, signal, { flipY, mipmaps })
    if (pixelated) {
      texture.updateSamplingMode(1)
    }
    return texture
  } catch (err) {
    if (options.retry) throw err
    return await fetchNoImageTexture(scene)
  }
}

export async function fetchAtlasTexture(scene: BABYLON.Scene): Promise<BABYLON.Texture> {
  try {
    return await fetchAndCreateTexture(scene, '/textures/atlas-ao' + getGpuTextureFormat())
  } catch (err) {
    console.error('Error loading default atlas texture', err)
    return new BABYLON.Texture(null, scene)
  }
}

export async function fetchNoImageTexture(scene: BABYLON.Scene): Promise<BABYLON.Texture> {
  return new Promise((resolve, reject) => {
    const texture: BABYLON.Texture = new BABYLON.Texture(
      process.env.ASSET_PATH + '/images/' + 'no-image' + getGpuTextureFormat(),
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => setTimeout(() => resolve(texture), 2),
      reject,
    )
  })
}

export function createWhiteTexture(scene: BABYLON.Scene): BABYLON.Texture {
  return new BABYLON.Texture('data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', scene, true, false, BABYLON.Texture.NEAREST_SAMPLINGMODE)
}

/**
 * Build URL for the compressor service.
 * The compressor will compress the source image and upload to the CDN bucket.
 * Returns empty string if URL is invalid.
 */
export const buildCompressorUrl = (srcURL: string, transparent: boolean, stretch = false, size?: number | 'passthrough'): string => {
  try {
    srcURL = new URL(srcURL).toString()
  } catch (e) {
    return ''
  }

  if (!process.env.TEXTURE_HOST) {
    return srcURL
  }

  let url = `${process.env.TEXTURE_HOST}/compressed?url=${encodeURIComponent(srcURL)}`

  const mode = transparent ? 'transparent' : 'color'
  url += `&mode=${mode}`

  if (srcURL.match('.gif')) {
    url += '&gif=sheet'
  }

  if (stretch) {
    url += '&stretch=true'
  }

  if (size) {
    if (size === 'passthrough') {
      url += '&passthrough=true'
    } else {
      url += `&size=${size}`
    }
  }

  if (config.texture_cachebuster) {
    url += `&version=${config.texture_cachebuster}`
  }

  // Hint must be last so BabylonJS knows to load as compressed texture
  url += `&hint=${getGpuTextureFormat()}`

  return url
}

/**
 * Get both CDN bucket URL (cached) and compressor URL (fallback).
 * Returns null if source URL is invalid.
 */
function getTextureUrls(srcURL: string | null, transparent: boolean, stretch: boolean, size?: number | 'passthrough'): TextureUrls | null {
  if (!srcURL) {
    return null
  }

  if (isMobile()) {
    if (!process.env.TEXTURE_HOST) return null
    const url = buildCompressorUrl(srcURL, transparent, stretch, 256).replace('&gif=sheet', '').replace('&hint=', '&gif=first&hint=')
    return { cachedUrl: url, compressorUrl: url }
  }

  const cachedUrl = buildCachedTextureUrl(srcURL, transparent, stretch, size)
  if (!cachedUrl) {
    return null
  }

  const compressorUrl = buildCompressorUrl(srcURL, transparent, stretch, size)
  return { cachedUrl, compressorUrl }
}

async function fetchAndCreateTexture(scene: BABYLON.Scene, url: string, backupURL?: string, signal?: AbortSignal, options: Pick<TextureOptions, 'flipY' | 'mipmaps'> = {}): Promise<BABYLON.Texture> {
  const { flipY = true, mipmaps = true } = options

  const data = await fetchWithFallback(url, backupURL, signal)
  const texture = await createTexture(scene, url, data.buffer, flipY, mipmaps)

  if (data?.metadata?.frames > 1) {
    registerAnimation(data.metadata, texture)
  }

  return texture
}

async function fetchWithFallback(url: string, backupURL: string | undefined, signal: AbortSignal | undefined): Promise<TextureData> {
  try {
    return await deduplicateFetch(url, signal)
  } catch (err) {
    if (signal?.aborted || !backupURL) {
      throw err
    }
    return await deduplicateFetch(backupURL, signal)
  }
}

async function deduplicateFetch(url: string, signal?: AbortSignal): Promise<TextureData> {
  const existing = currentFetches.get(url)
  if (existing) {
    return existing
  }

  const fetchPromise = fetchTextureData(url, signal)
  currentFetches.set(url, fetchPromise)

  try {
    return await fetchPromise
  } finally {
    currentFetches.delete(url)
  }
}

async function fetchTextureData(url: string, signal?: AbortSignal): Promise<TextureData> {
  const response = await fetch(url, { method: 'GET', signal })
  if (!response.ok) {
    const retry = response.headers.get('Retry-After')
    const retryAfter = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0
    throw Object.assign(new Error(response.headers.get('x-error') || `${response.status} - unable to load texture`), { retryAfter })
  }
  return {
    buffer: await response.arrayBuffer(),
    metadata: metadataFromResponse(response),
  }
}

async function createTexture(scene: BABYLON.Scene | BABYLON.ThinEngine | null, url: string, buffer: ArrayBuffer, flipY: boolean, mipmaps: boolean): Promise<BABYLON.Texture> {
  let texture: BABYLON.Texture
  await new Promise<void>((resolve, reject) => {
    texture = new BABYLON.Texture(`data:${url}`, scene, !mipmaps, flipY, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, resolve, (_message, error) => reject(error || new Error('Texture decode failed')), buffer, true)
  }).catch((error) => {
    texture?.dispose()
    throw error
  })
  if (isMobile() && !url.startsWith('/textures/')) {
    const { width, height } = texture!.getSize()
    if (width > 256 || height > 256) {
      texture!.dispose()
      throw new Error('Mobile texture exceeds 256px')
    }
  }
  return texture!
}
