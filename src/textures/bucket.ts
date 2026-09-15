// ABOUTME: Builds URLs for the CDN texture bucket where compressed textures are cached.
// ABOUTME: Uses SHA1 hash of source URL + options to create deterministic bucket paths.

import { textureHash, textureHashOptions, type TextureHashOptions } from '../../common/helpers/texture-hash'
import { getGpuTextureFormat } from './gpu'
import config from '../../common/config'

/**
 * Build URL for a cached texture in the CDN bucket.
 * The URL is deterministic: same source + options = same bucket path.
 * This is the URL the compressor would upload to after processing.
 */
export const buildCachedTextureUrl = (srcURL: string, transparent: boolean, stretch = false, size?: number | 'passthrough'): string => {
  if (!process.env.TEXTURE_HOST) {
    return srcURL
  }

  const host = process.env.TEXTURE_BUCKET || 'https://textures.sfo2.cdn.digitaloceanspaces.com'

  try {
    srcURL = new URL(srcURL).toString()
  } catch (e) {
    return ''
  }

  const opts = buildHashOptions(size, transparent, stretch, !!srcURL.match('.gif'))
  const hash = textureHash(srcURL, opts)

  let url = `${host}/compressed/${hash}_medium${getGpuTextureFormat()}`

  if (config.texture_cachebuster) {
    url += `?version=${config.texture_cachebuster}`
    // Hint must be last so BabylonJS knows to load as compressed texture
    url += `&hint=${getGpuTextureFormat()}`
  }

  return url
}

function buildHashOptions(size: number | 'passthrough' | undefined, transparent: boolean, stretch: boolean, isGif: boolean): TextureHashOptions {
  return textureHashOptions(transparent, stretch, isGif, size)
}
