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
 *   TEXTURE_BUCKET - CDN bucket URL (default: textures.sfo2.cdn.digitaloceanspaces.com)
 */

import config from '../../common/config'
import { getGpuTextureFormat } from './gpu'
import { buildCachedTextureUrl } from './bucket'
import { Metadata, metadataFromResponse } from './metadata-cache'
import { registerAnimation } from './animation'
import { EngineContext, SceneContext, Texture2D, createSolidTexture2D, loadKtx2Texture2D, loadKtxTexture2D, loadTexture2D } from '@babylonjs/lite'

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
}

type TextureUrls = {
  cachedUrl: string
  compressorUrl: string
}

// Prevent multiple parallel requests for the same URL
const currentFetches = new Map<string, Promise<TextureData>>()

export async function fetchTexture(scene: SceneContext, srcURL: string | null, signal: AbortSignal, options: TextureOptions = {}): Promise<Texture2D> {
  const { transparent = false, stretch = true, pixelated = false, flipY = true, mipmaps = true } = options

  const urls = getTextureUrls(srcURL, transparent, stretch)
  if (!urls) {
    return await fetchNoImageTexture(scene)
  }

  try {
    const texture = await fetchAndCreateTexture(scene, urls.cachedUrl, urls.compressorUrl, signal, { flipY, mipmaps, pixelated })
    return texture
  } catch (err) {
    return await fetchNoImageTexture(scene)
  }
}

export async function fetchAtlasTexture(scene: SceneContext): Promise<Texture2D> {
  try {
    return await loadTex(scene.surface.engine, '/textures/atlas-ao' + getGpuTextureFormat(), texOpts(true, true, false))
  } catch (err) {
    console.error('Error loading default atlas texture', err)
    return fetchNoImageTexture(scene)
  }
}

export async function fetchNoImageTexture(scene: SceneContext): Promise<Texture2D> {
  const png = `${process.env.ASSET_PATH}/images/no-image.png`
  try {
    return await loadTexture2D(scene.surface.engine, png, { srgb: true })
  } catch {
    return loadTexture2D(scene.surface.engine, png)
  }
}

export function createWhiteTexture(scene: SceneContext): Texture2D {
  return createSolidTexture2D(scene.surface.engine, 1, 1, 1, 1)
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

  const cachedUrl = buildCachedTextureUrl(srcURL, transparent, stretch, size)
  if (!cachedUrl) {
    return null
  }

  const compressorUrl = buildCompressorUrl(srcURL, transparent, stretch, size)
  return { cachedUrl, compressorUrl }
}

async function fetchAndCreateTexture(
  scene: SceneContext,
  url: string,
  backupURL?: string,
  signal?: AbortSignal,
  options: Pick<TextureOptions, 'flipY' | 'mipmaps' | 'pixelated'> = {},
): Promise<Texture2D> {
  const { flipY = true, mipmaps = true, pixelated = false } = options
  const engine = scene.surface.engine
  const opts = texOpts(flipY, mipmaps, pixelated)

  try {
    const texture = await loadTex(engine, url, opts, signal)
    const data = await deduplicateFetch(url, signal).catch(() => null)
    if (data?.metadata?.frames && data.metadata.frames > 1) {
      registerAnimation(data.metadata, texture)
    }
    return texture
  } catch (err) {
    if (signal?.aborted || !backupURL) {
      throw err
    }
    const texture = await loadTex(engine, backupURL, opts, signal)
    const data = await deduplicateFetch(backupURL, signal).catch(() => null)
    if (data?.metadata?.frames && data.metadata.frames > 1) {
      registerAnimation(data.metadata, texture)
    }
    return texture
  }
}

function texOpts(flipY: boolean, mipmaps: boolean, pixelated: boolean) {
  return {
    invertY: flipY,
    mipMaps: mipmaps,
    srgb: true,
    minFilter: (pixelated ? 'nearest' : 'linear') as GPUFilterMode,
    magFilter: (pixelated ? 'nearest' : 'linear') as GPUFilterMode,
  }
}

async function loadTex(engine: EngineContext, url: string, opts: ReturnType<typeof texOpts>, signal?: AbortSignal): Promise<Texture2D> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (/\.ktx2(\?|$)/i.test(url)) {
    return loadKtx2Texture2D(engine, url, true)
  }
  if (/\.ktx(\?|$)/i.test(url)) {
    return loadKtxTexture2D(engine, url, [], opts)
  }
  return loadTexture2D(engine, url, opts)
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
    throw response.headers.get('x-error') || `${response.status} - unable to load texture`
  }
  return {
    buffer: await response.arrayBuffer(),
    metadata: metadataFromResponse(response),
  }
}

