import { simpleHash } from './utils'

export const KTX_SUFFIXES = ['.dxt.ktx', '.pvrtc.ktx', '.etc.ktx', '.astc.ktx'] as const

export type TextureHashOptions = {
  size: number
  mode: 'color' | 'transparent'
  stretch: boolean
  gif: 'sheet'
  passthrough?: boolean
  dontFlipY?: boolean
}

export function textureHashOptions(transparent = false, stretch = false, isGif = false, size?: number | 'passthrough'): TextureHashOptions {
  return {
    size: size && size !== 'passthrough' ? size : 0,
    mode: transparent ? 'transparent' : 'color',
    stretch,
    gif: 'sheet',
    passthrough: size === 'passthrough',
    dontFlipY: false,
  }
}

export function textureHash(srcURL: string, opts: TextureHashOptions): string {
  const hashableOptions = { ...opts }
  if (!hashableOptions.passthrough) delete hashableOptions.passthrough
  if (!hashableOptions.dontFlipY) delete hashableOptions.dontFlipY
  return simpleHash(srcURL + JSON.stringify(hashableOptions))
}

export function textureBucketPath(hash: string, suffix: string) {
  return `compressed/${hash}_medium${suffix}`
}

export function textureBucketUrl(hash: string, suffix: string, host?: string) {
  const cdn = host || 'https://textures.sfo2.cdn.digitaloceanspaces.com'
  return `${cdn.replace(/\/$/, '')}/${textureBucketPath(hash, suffix)}`
}
